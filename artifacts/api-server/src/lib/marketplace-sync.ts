import { createHash, randomUUID } from 'node:crypto';
import { pool, type MarketplaceConnection } from '@workspace/db';
import { decryptCredentials } from './marketplace-credentials';
import type { MarketplaceSnapshot } from './marketplace-data';
import { dashboardWindow } from './dashboard-layout';
import { SyncDeferred, SyncRejected, syncContext, syncPolicy, assertReplaySafe, retryAtFromHeaders, packSyncResult, unpackSyncResult, type SyncContext } from './sync-context';

export type DatasetKind = 'snapshot' | 'finance' | 'catalog';
type Params = { from?: string; to?: string };
type Job = { id: string; connection_id: number; revision: string; kind: DatasetKind; params: Params; generation: Date; lease_token: string; failures: number };
type Handler = (connection: MarketplaceConnection, params: Params) => Promise<unknown>;
type Handlers = Record<DatasetKind, Handler>;
export type SyncStatus = { state: string; updatedAt: string | null; nextAttemptAt: string; stale: boolean };
const revisionOf = (ciphertext: string) => createHash('sha256').update(ciphertext).digest('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function datasetStatuses(connectionIds: number[]) {
  if (!connectionIds.length) return [];
  const {rows}=await pool.query(`SELECT connection_id AS "storeId",kind,params,state,
    updated_at AS "sourceUpdatedAt",next_attempt_at AS "nextAttemptAt",last_error AS error,
    result IS NOT NULL AS "hasSavedResult",partial_result IS NOT NULL AS "hasPartialProgress"
    FROM marketplace_sync_jobs WHERE connection_id=ANY($1::integer[]) AND accessed_at>now()-interval '1 day'
    ORDER BY connection_id,kind,next_attempt_at`,[connectionIds]);
  return rows;
}

export async function sharedSnapshot(connection: MarketplaceConnection, from: string, to: string) {
  const today = new Date().toISOString().slice(0, 10);
  const rollingFrom = new Date(Date.parse(today) - 89 * 86400000).toISOString().slice(0,10);
  // Ozon's day rows can serve every section/filter from the same 90-day feed.
  // WB funnel totals are period-specific; only its raw sales feed is shared.
  const range = connection.marketplace === 'ozon' && from >= rollingFrom && to <= today
    ? { from: rollingFrom, to: today } : { from, to };
  const snapshot = await sharedDataset<MarketplaceSnapshot>(connection, 'snapshot', range);
  if (connection.marketplace !== 'ozon') return snapshot;
  snapshot.daily = new Map([...snapshot.daily].filter(([date]) => date >= from && date <= to));
  snapshot.funnel = [...snapshot.daily.values()].reduce((total, point) => ({
    orders: total.orders+point.orders, units: total.units+point.units,
    views: total.views+point.views, cartAdds: total.cartAdds+point.cartAdds,
  }), { orders: 0, units: 0, views: 0, cartAdds: 0 });
  return snapshot;
}

export async function ensureMarketplaceSyncSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketplace_sync_jobs (
      id text PRIMARY KEY, connection_id integer NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      revision text NOT NULL, kind text NOT NULL, params jsonb NOT NULL,
      state text NOT NULL DEFAULT 'queued', result text, partial_result text,
      generation timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
      next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token text,
      failures integer NOT NULL DEFAULT 0, last_error text, accessed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS marketplace_sync_due ON marketplace_sync_jobs(next_attempt_at) WHERE state IN ('queued','waiting','running');
    CREATE TABLE IF NOT EXISTS marketplace_sync_pages (
      id text PRIMARY KEY, connection_id integer NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      revision text NOT NULL, payload text NOT NULL, status integer NOT NULL,
      fetched_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS marketplace_sync_budgets (
      id text PRIMARY KEY, next_allowed_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Upgrade old generic Ozon parser failures once; safe HTTP errors below get
  // explicit codes and are never automatically reset by this migration.
  await pool.query(`UPDATE marketplace_sync_jobs j SET state='queued',next_attempt_at=now(),last_error=NULL
    FROM marketplace_connections c WHERE j.connection_id=c.id AND c.marketplace='ozon'
    AND j.kind='snapshot' AND j.state='blocked'
    AND j.last_error='Площадка отклонила загрузку или вернула неподдерживаемые данные.'`);
}

// Callers MUST select the connection through their existing company/store ACL first.
// Neither user roles nor mutable lastSyncAt are part of a provider dataset identity.
export async function sharedDataset<T>(connection: MarketplaceConnection, kind: DatasetKind, params: Params): Promise<T & { sync: SyncStatus }> {
  const revision = revisionOf(connection.credentialsCiphertext);
  const id = hash(`${connection.companyId}:${connection.id}:${revision}:${kind}:${JSON.stringify(params)}`);
  const ttl = kind === 'snapshot' ? 2 * 3600_000 : kind === 'finance' ? 12 * 3600_000 : 6 * 3600_000;
  const { rows } = await pool.query(`
    INSERT INTO marketplace_sync_jobs(id,connection_id,revision,kind,params) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(id) DO UPDATE SET accessed_at=now(),
      state=CASE WHEN marketplace_sync_jobs.state='ready' AND marketplace_sync_jobs.next_attempt_at<=now() THEN 'queued' ELSE marketplace_sync_jobs.state END,
      generation=CASE WHEN marketplace_sync_jobs.state='ready' AND marketplace_sync_jobs.next_attempt_at<=now() THEN now() ELSE marketplace_sync_jobs.generation END
    RETURNING state,result,partial_result,updated_at,next_attempt_at`, [id, connection.id, revision, kind, params]);
  const row = rows[0];
  const value = row.result ?? row.partial_result;
  if (!value) {
    if (row.state === 'blocked') throw new Error('Не удалось завершить выгрузку: нужна проверка ответа площадки и прав ключа в «Подключениях API».');
    throw new SyncDeferred(Math.max(Date.now() + 5000, new Date(row.next_attempt_at).getTime()));
  }
  const result = unpackSyncResult<T>(value);
  return Object.assign(result as object, { sync: {
    state: row.state, updatedAt: row.updated_at?.toISOString() ?? null,
    nextAttemptAt: new Date(row.next_attempt_at).toISOString(),
    stale: row.state !== 'ready' || !row.updated_at || Date.now() - row.updated_at.getTime() > ttl,
  } }) as T & { sync: SyncStatus };
}

function budgetScope(connection: MarketplaceConnection): string {
  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  if (connection.marketplace === 'ozon') return hash(`ozon:${credentials.clientId}`);
  // Local JWT parsing selects a budget identity only; it never grants access.
  // Unknown identity deliberately shares one conservative company-wide budget.
  try {
    const claims = JSON.parse(Buffer.from((credentials.apiKey ?? '').split('.')[1] ?? '', 'base64url').toString());
    const seller = claims.sid ?? claims.sellerId;
    if (typeof seller === 'string' && seller) return hash(`wb:basic:${seller}`);
  } catch { /* opaque tokens use the company-wide fallback */ }
  return hash(`wb:basic:company:${connection.companyId}`);
}

async function reserveBudget(id: string, interval: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO marketplace_sync_budgets(id) VALUES($1) ON CONFLICT DO NOTHING', [id]);
    const { rows } = await client.query('SELECT next_allowed_at,now() AS clock FROM marketplace_sync_budgets WHERE id=$1 FOR UPDATE', [id]);
    const next = rows[0].next_allowed_at.getTime();
    if (next > rows[0].clock.getTime()) throw new SyncDeferred(next);
    await client.query("UPDATE marketplace_sync_budgets SET next_allowed_at=now()+$2*interval '1 millisecond' WHERE id=$1", [id, interval]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function pageFetch(job: Job, connection: MarketplaceConnection, url: string, init: RequestInit): Promise<Response> {
  assertReplaySafe(url, init.method ?? 'GET');
  const policy = syncPolicy(url);
  const pageId = hash(`${connection.companyId}:${connection.id}:${job.revision}:${init.method ?? 'GET'}:${url}:${String(init.body ?? '')}`);
  const cached = await pool.query(`SELECT payload,status,fetched_at FROM marketplace_sync_pages WHERE id=$1 AND (expires_at>now() OR fetched_at>=$2)`, [pageId, job.generation]);
  if (cached.rows[0]) {
    if (cached.rows[0].status >= 400) throw new SyncRejected(cached.rows[0].status);
    syncContext.getStore()?.sourceTimes?.push(cached.rows[0].fetched_at.getTime());
    return new Response(cached.rows[0].status === 204 ? null : cached.rows[0].payload, { status: cached.rows[0].status, headers: { 'Content-Type': 'application/json' } });
  }
  const budget = hash(`${budgetScope(connection)}:${policy.group}`);
  await reserveBudget(budget, policy.interval);
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), redirect: 'error' }); }
  catch { throw new SyncDeferred(Date.now() + Math.max(60_000,policy.interval), 'network'); }
  if (response.status === 429 || response.status === 408 || response.status >= 500) {
    const retryAt = retryAtFromHeaders(response.headers, Date.now(), response.status === 429 ? policy.interval : 60_000);
    const saved = await pool.query('UPDATE marketplace_sync_budgets SET next_allowed_at=GREATEST(next_allowed_at,$2) WHERE id=$1 RETURNING next_allowed_at', [budget, new Date(retryAt)]);
    await response.body?.cancel();
    throw new SyncDeferred(saved.rows[0].next_allowed_at.getTime(), 'provider');
  }
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      const multiplier = new URL(url).hostname.endsWith('.wildberries.ru') ? 10 : 1;
      await pool.query("UPDATE marketplace_sync_budgets SET next_allowed_at=GREATEST(next_allowed_at,now()+$2*interval '1 millisecond') WHERE id=$1", [budget, policy.interval * multiplier]);
      // A bad request/auth failure is terminal for this exact request/revision.
      // Keep other sources refreshing without replaying the failed HTTP call.
      await pool.query(`INSERT INTO marketplace_sync_pages(id,connection_id,revision,payload,status,expires_at) VALUES($1,$2,$3,'{}',$4,'9999-01-01')
        ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload='{}',expires_at=EXCLUDED.expires_at`, [pageId,connection.id,job.revision,response.status]);
    }
    await response.body?.cancel();
    // Provider bodies can contain identifiers or credentials; never persist/log them.
    throw new SyncRejected(response.status);
  }
  if (response.headers.get('X-Ratelimit-Remaining') === '0') {
    const retryAt = retryAtFromHeaders(response.headers, Date.now(), policy.interval);
    await pool.query('UPDATE marketplace_sync_budgets SET next_allowed_at=GREATEST(next_allowed_at,$2) WHERE id=$1', [budget, new Date(retryAt)]);
  }
  const payload = response.status === 204 ? '' : await response.text();
  if (response.status !== 204) JSON.parse(payload); // Reject malformed/truncated pages before saving progress.
  await pool.query(`INSERT INTO marketplace_sync_pages(id,connection_id,revision,payload,status,expires_at) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,status=EXCLUDED.status,fetched_at=now(),expires_at=EXCLUDED.expires_at`,
  [pageId, connection.id, job.revision, payload, response.status, new Date(Date.now() + policy.ttl)]);
  syncContext.getStore()?.sourceTimes?.push(Date.now());
  return new Response(response.status === 204 ? null : payload, { status: response.status, headers: { 'Content-Type': 'application/json' } });
}

export async function workOne(handlers: Handlers): Promise<boolean> {
  const token = randomUUID();
  const { rows } = await pool.query(`UPDATE marketplace_sync_jobs SET state='running',lease_until=now()+interval '2 minutes',lease_token=$1
    WHERE id=(SELECT id FROM marketplace_sync_jobs WHERE
      (state IN ('queued','waiting') AND next_attempt_at<=now()) OR (state='running' AND lease_until<now())
      ORDER BY next_attempt_at,accessed_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, [token]);
  const job = rows[0] as Job | undefined;
  if (!job) return false;
  const heartbeat = setInterval(() => { void pool.query("UPDATE marketplace_sync_jobs SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND lease_token=$2", [job.id, token]).catch(() => {}); }, 20_000);
  heartbeat.unref();
  const context: SyncContext = {
    deferredUntil: [],
    sourceTimes: [],
    fetch: async (url, init) => {
      try { return await pageFetch(job, connection!, url, init); }
      catch (error) { if (error instanceof SyncDeferred) context.deferredUntil.push(error.retryAt); throw error; }
    },
  };
  let connection: MarketplaceConnection | undefined;
  try {
    const result = await pool.query('SELECT * FROM marketplace_connections WHERE id=$1', [job.connection_id]);
    const raw = result.rows[0];
    if (!raw || revisionOf(raw.credentials_ciphertext) !== job.revision) {
      await pool.query('DELETE FROM marketplace_sync_jobs WHERE id=$1 AND lease_token=$2', [job.id, token]);
      return true;
    }
    connection = { id: raw.id, companyId: raw.company_id, marketplace: raw.marketplace, storeName: raw.store_name, credentialsCiphertext: raw.credentials_ciphertext } as MarketplaceConnection;
    const value = await syncContext.run(context, () => handlers[job.kind](connection!, job.params));
    const serialized = packSyncResult(value);
    const sourceAt = new Date(context.sourceTimes?.length ? Math.min(...context.sourceTimes) : Date.now());
    if (context.deferredUntil.length && job.kind === 'catalog') throw new SyncDeferred(Math.min(...context.deferredUntil));
    if (context.deferredUntil.length) {
      await pool.query(`UPDATE marketplace_sync_jobs SET partial_result=$3,state='waiting',next_attempt_at=$4,updated_at=CASE WHEN result IS NULL THEN $5 ELSE updated_at END,lease_until=NULL,lease_token=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2`, [job.id, token, serialized, new Date(Math.min(...context.deferredUntil)),sourceAt]);
    } else {
      const ttl = job.kind === 'snapshot' ? 2 * 3600_000 : job.kind === 'finance' ? 12 * 3600_000 : 6 * 3600_000;
      await pool.query(`UPDATE marketplace_sync_jobs SET result=$3,partial_result=NULL,state='ready',updated_at=$5,next_attempt_at=$4,lease_until=NULL,lease_token=NULL,failures=0,last_error=NULL WHERE id=$1 AND lease_token=$2`, [job.id, token, serialized, new Date(Math.max(Date.now()+5000, sourceAt.getTime()+ttl)), sourceAt]);
      await pool.query('UPDATE marketplace_connections SET last_sync_at=GREATEST(last_sync_at,$2) WHERE id=$1', [connection.id,sourceAt]);
    }
  } catch (error) {
    const deferred = error instanceof SyncDeferred || context.deferredUntil.length > 0;
    const failures = error instanceof SyncDeferred && error.reason === 'budget' ? job.failures : job.failures + 1;
    const retryAt = error instanceof SyncDeferred ? error.retryAt : context.deferredUntil.length ? Math.min(...context.deferredUntil) : Date.now() + 3600_000;
    console.warn('Marketplace dataset deferred or blocked', { connectionId: job.connection_id, kind: job.kind, deferred, failures });
    await pool.query(`UPDATE marketplace_sync_jobs SET state=$3,next_attempt_at=$4,lease_until=NULL,lease_token=NULL,failures=$5,last_error=$6 WHERE id=$1 AND lease_token=$2`,
      [job.id, token, deferred ? 'waiting' : 'blocked', new Date(Math.max(retryAt, failures > 8 ? Date.now() + 24 * 3600_000 : 0)), failures,
        deferred ? 'Ожидание доступного интервала площадки.' : error instanceof SyncRejected ? error.message : error instanceof Error && /^(Ozon|ВБ):/.test(error.message) ? error.message : 'Не удалось обработать ответ площадки.']);
  } finally { clearInterval(heartbeat); }
  return true;
}

export function startMarketplaceSync(handlers: Handlers): () => void {
  let stopped = false;
  let running = false;
  let lastSeed = 0;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      if (Date.now() - lastSeed > 60_000) { await seedCommonDatasets(); lastSeed = Date.now(); }
      // Keep recently used datasets warm without relying on page navigation.
      // Historic ranges stop refreshing ten minutes after their last consumer.
      await pool.query(`UPDATE marketplace_sync_jobs SET state='queued',generation=now()
        WHERE state='ready' AND next_attempt_at<=now() AND accessed_at>now()-interval '10 minutes'`);
      for (let i = 0; i < 8 && !stopped; i++) if (!await workOne(handlers)) break;
    }
    catch { console.warn('Marketplace queue unavailable; durable leases will recover on the next tick.'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 2000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}

async function seedCommonDatasets(): Promise<void> {
  const { rows } = await pool.query("SELECT * FROM marketplace_connections WHERE marketplace IN ('ozon','wildberries')");
  const current = dashboardWindow('current');
  const previous = dashboardWindow('previous');
  const monthFrom = current.to.slice(0,7)+'-01';
  const previousMonthTo = new Date(Date.parse(monthFrom)-86400000).toISOString().slice(0,10);
  for (const raw of rows) {
    const connection = { id: raw.id, companyId: raw.company_id, marketplace: raw.marketplace, storeName: raw.store_name, credentialsCiphertext: raw.credentials_ciphertext } as MarketplaceConnection;
    const to = raw.marketplace === 'ozon' ? [current.to,new Date().toISOString().slice(0,10)].sort()[0] : current.to;
    // Seed read-only sources. Importing catalog rows into editable products remains manual.
    await Promise.allSettled([
      sharedSnapshot(connection,current.from,to), sharedSnapshot(connection,previous.from,previous.to),
      sharedDataset(connection,'finance',{from:monthFrom,to}),
      sharedDataset(connection,'finance',{from:previousMonthTo.slice(0,7)+'-01',to:previousMonthTo}),
      sharedDataset(connection,'catalog',{}),
    ]);
  }
}
