import { createHash, randomUUID } from 'node:crypto';
import { pool, type MarketplaceConnection } from '@workspace/db';
import { decryptCredentials } from './marketplace-credentials';
import { projectOzonPeriod,type MarketplaceSnapshot } from './marketplace-data';
import type { OzonBuyouts } from './ozon-buyouts';
import {metricAccessReason,safeSellerInfo,type OzonSubscription} from './ozon-subscription';
import { dashboardWindow } from './dashboard-layout';
import { SyncDeferred, SyncRejected, syncContext, syncPolicy, assertReplaySafe, retryAtFromHeaders, packSyncResult, unpackSyncResult, type SyncContext } from './sync-context';

export type DatasetKind = 'snapshot' | 'finance' | 'catalog' | 'buyouts' | 'subscription';
type Params = { from?: string; to?: string; sourceVersion?: number };
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
  if(connection.marketplace!=='ozon')return sharedDataset<MarketplaceSnapshot>(connection,'snapshot',range);
  const oldestBuyout=new Date(Date.parse(today)-31*86400000).toISOString().slice(0,10);
  const [analytic,buyouts,subscription]=await Promise.allSettled([
    sharedDataset<MarketplaceSnapshot>(connection,'snapshot',range),
    sharedDataset<OzonBuyouts>(connection,'buyouts',{from:oldestBuyout,to:today}),
    sharedDataset<OzonSubscription>(connection,'subscription',{}),
  ]);
  if(analytic.status==='rejected' && buyouts.status==='rejected' && subscription.status==='rejected')throw analytic.reason;
  const snapshot=analytic.status==='fulfilled' ? analytic.value : {
    daily:new Map(),funnel:{orders:0,units:0,views:0,cartAdds:0},
    unavailable:{orders:'Аналитика заказов Ozon загружается.',revenue:'Аналитика сумм Ozon загружается.',views:'Аналитика просмотров Ozon загружается.',carts:'Аналитика корзин Ozon загружается.'},
    sync:buyouts.status==='fulfilled'?buyouts.value.sync:subscription.status==='fulfilled'?subscription.value.sync:undefined!,
  } as MarketplaceSnapshot & {sync:SyncStatus};
  snapshot.subscription=subscription.status==='fulfilled' ? subscription.value : {type:'UNKNOWN',label:subscription.reason instanceof SyncDeferred?'Тариф уточняется':'Не удалось определить тариф',isPremium:null,advancedAnalytics:null,checkedAt:null};
  const projected=projectOzonPeriod(snapshot,from,to);
  snapshot.daily=projected.daily;snapshot.unavailable=projected.unavailable;
  let missingBuyouts=false;
  for(let stamp=Date.parse(from);stamp<=Date.parse(to);stamp+=86400000){
    const date=new Date(stamp).toISOString().slice(0,10);
    const point=snapshot.daily.get(date)??{date,revenue:0,orders:0,units:0,views:0,cartAdds:0,missing:{views:Boolean(snapshot.unavailable?.views),carts:Boolean(snapshot.unavailable?.carts),orders:Boolean(snapshot.unavailable?.orders),revenue:Boolean(snapshot.unavailable?.revenue)}};
    const realization=buyouts.status==='fulfilled'?buyouts.value.daily.get(date):undefined;
    point.boughtUnits=realization?.units??null;point.boughtAmount=realization?.amount??null;
    if(!realization)missingBuyouts=true;
    snapshot.daily.set(date,point);
  }
  if(missingBuyouts){
    snapshot.unavailable??={};
    const error=buyouts.status==='rejected'?buyouts.reason:null;
    snapshot.unavailable.buyouts=error instanceof SyncRejected && error.status===403
      ? error.reason==='subscription' ? error.message : 'Ежедневный отчёт выкупов Ozon недоступен (403). Метод требует Premium Plus/Pro и прав API «Финансы».'
      : error instanceof Error ? `Выкупы Ozon: ${error.message}` : 'Ежедневные выкупы Ozon доступны через API за последние 32 календарных дня.';
  }
  const knownSubscription=subscription.status==='fulfilled'&&!subscription.value.sync.stale ? subscription.value : undefined;
  for(const field of ['views','carts'] as const){
    if(snapshot.unavailable?.[field])snapshot.unavailable[field]=metricAccessReason(knownSubscription,snapshot.unavailable[field]);
  }
  if(snapshot.unavailable?.buyouts){
    const error=buyouts.status==='rejected'?buyouts.reason:null;
    snapshot.unavailable.buyouts=metricAccessReason(knownSubscription,snapshot.unavailable.buyouts,error instanceof SyncRejected&&error.reason==='subscription');
  }
  snapshot.funnel = [...snapshot.daily.values()].reduce((total, point) => ({
    orders: total.orders+point.orders, units: total.units+(point.boughtUnits??0),
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
      id text PRIMARY KEY, next_allowed_at timestamptz NOT NULL DEFAULT now(),request_day text,request_count integer NOT NULL DEFAULT 0
    );
  `);
  await pool.query('ALTER TABLE marketplace_sync_budgets ADD COLUMN IF NOT EXISTS request_day text; ALTER TABLE marketplace_sync_budgets ADD COLUMN IF NOT EXISTS request_count integer NOT NULL DEFAULT 0');
  // Upgrade old generic Ozon parser failures once; safe HTTP errors below get
  // explicit codes and are never automatically reset by this migration.
  await pool.query(`UPDATE marketplace_sync_jobs j SET state='queued',next_attempt_at=now(),last_error=NULL
    FROM marketplace_connections c WHERE j.connection_id=c.id AND c.marketplace='ozon'
    AND j.kind='snapshot' AND j.state='blocked'
    AND j.last_error='Площадка отклонила загрузку или вернула неподдерживаемые данные.'`);
  await pool.query(`UPDATE marketplace_sync_jobs j SET state='queued',next_attempt_at=now(),params=params||'{"sourceVersion":3}'::jsonb
    FROM marketplace_connections c WHERE j.connection_id=c.id AND c.marketplace='ozon'
    AND j.kind='snapshot' AND (j.params->>'sourceVersion') IS DISTINCT FROM '3'`);
  // Rebuild derived results from retained raw pages; do not reset provider budgets.
  await pool.query(`UPDATE marketplace_sync_jobs j SET state='queued',next_attempt_at=now(),params=params||'{"sourceVersion":5}'::jsonb
    FROM marketplace_connections c WHERE j.connection_id=c.id AND
    (c.marketplace='wildberries' AND j.kind='snapshot')
    AND (j.params->>'sourceVersion') IS DISTINCT FROM '5'`);
  await pool.query(`UPDATE marketplace_sync_jobs j SET state='queued',next_attempt_at=now(),params=params||'{"sourceVersion":7}'::jsonb
    FROM marketplace_connections c WHERE j.connection_id=c.id AND c.marketplace='ozon' AND j.kind='finance'
    AND (j.params->>'sourceVersion') IS DISTINCT FROM '7'`);
}

// Callers MUST select the connection through their existing company/store ACL first.
// Neither user roles nor mutable lastSyncAt are part of a provider dataset identity.
export async function sharedDataset<T>(connection: MarketplaceConnection, kind: DatasetKind, params: Params): Promise<T & { sync: SyncStatus }> {
  const revision = revisionOf(connection.credentialsCiphertext);
  const id = hash(`${connection.companyId}:${connection.id}:${revision}:${kind}:${JSON.stringify(params)}`);
  const ttl = kind==='subscription'?3600_000:kind === 'snapshot' ? 2 * 3600_000 : kind === 'finance' ? 12 * 3600_000 : 6 * 3600_000;
  const { rows } = await pool.query(`
    INSERT INTO marketplace_sync_jobs(id,connection_id,revision,kind,params) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(id) DO UPDATE SET accessed_at=now(),
      state=CASE WHEN marketplace_sync_jobs.state='ready' AND marketplace_sync_jobs.next_attempt_at<=now() THEN 'queued' ELSE marketplace_sync_jobs.state END,
      generation=CASE WHEN marketplace_sync_jobs.state='ready' AND marketplace_sync_jobs.next_attempt_at<=now() THEN now() ELSE marketplace_sync_jobs.generation END
    RETURNING state,result,partial_result,updated_at,next_attempt_at,last_error`, [id, connection.id, revision, kind, connection.marketplace==='ozon' && kind==='snapshot'?{...params,sourceVersion:3}:params]);
  const row = rows[0];
  const value = row.result ?? row.partial_result;
  if (!value) {
    if(connection.marketplace==='wildberries'&&kind==='snapshot'&&row.state==='blocked'&&row.last_error==='ВБ: в воронке отсутствуют обязательные показатели.'){
      await pool.query("UPDATE marketplace_sync_jobs SET state='queued',next_attempt_at=now() WHERE id=$1 AND state='blocked'",[id]);
      throw new SyncDeferred(Date.now()+5000,'budget','Повторно обрабатываем сохранённый ответ ВБ.');
    }
    if(row.last_error==='Ozon: данные не загружены из-за ограничения подписки. Требуется Premium Plus или Premium Pro.')throw new SyncRejected(403,'subscription');
    if (row.state === 'blocked') {
      if(row.last_error==='Площадка отклонила запрос (HTTP 403).')throw new SyncRejected(403);
      if(row.last_error==='Ozon: данные не загружены из-за ограничения подписки. Требуется Premium Plus или Premium Pro.')throw new SyncRejected(403,'subscription');
      throw new Error(row.last_error??'Не удалось завершить выгрузку: нужна проверка ответа площадки и прав ключа.');
    }
    const detail=row.last_error?.split('Данные загружаются в фоне.')[0].trim();
    throw new SyncDeferred(Math.max(Date.now() + 5000, new Date(row.next_attempt_at).getTime()),'budget',detail);
  }
  const result = unpackSyncResult<T>(value);
  // During a zero-downtime rollout an older worker may finish a migrated job.
  // Validate the derived shape as well as params so those old results cannot
  // stay 'ready' until the next 12-hour finance refresh.
  const shape=result as Record<string,unknown>;
  const outdated=connection.marketplace==='ozon'&&kind==='finance'&&shape.dashboardVersion!==7
    ||connection.marketplace==='wildberries'&&kind==='snapshot'&&shape.funnel&&!shape.wbDailyFunnel;
  if(outdated&&row.state==='ready'){
    await pool.query("UPDATE marketplace_sync_jobs SET state='queued',next_attempt_at=now() WHERE id=$1 AND state='ready'",[id]);
    row.state='queued';row.next_attempt_at=new Date();
  }
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

async function reserveBudget(id: string, interval: number, dailyLimit?:number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO marketplace_sync_budgets(id) VALUES($1) ON CONFLICT DO NOTHING', [id]);
    const { rows } = await client.query("SELECT *,now() AS clock,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AS today FROM marketplace_sync_budgets WHERE id=$1 FOR UPDATE", [id]);
    const next = rows[0].next_allowed_at.getTime();
    if (next > rows[0].clock.getTime()) throw new SyncDeferred(next);
    if(dailyLimit && rows[0].request_day===rows[0].today && rows[0].request_count>=dailyLimit)throw new SyncDeferred(Date.parse(rows[0].today)+86400000);
    if(dailyLimit)await client.query('UPDATE marketplace_sync_budgets SET request_count=CASE WHEN request_day=$2 THEN request_count+1 ELSE 1 END,request_day=$2 WHERE id=$1',[id,rows[0].today]);
    await client.query("UPDATE marketplace_sync_budgets SET next_allowed_at=now()+$2*interval '1 millisecond' WHERE id=$1", [id, interval]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function pageFetch(job: Job, connection: MarketplaceConnection, url: string, init: RequestInit): Promise<Response> {
  assertReplaySafe(url, init.method ?? 'GET');
  const policy = syncPolicy(url);
  const sourceLabel:Record<string,string>={'wb:funnel':'ВБ — воронка','wb:sales':'ВБ — продажи','wb:finance':'ВБ — финансовый отчёт','wb:prices':'ВБ — цены','ozon:analytics':'Ozon — аналитика','ozon:subscription':'Ozon — тариф'};
  const source=sourceLabel[policy.group]??(connection.marketplace==='ozon'?'Ozon':'ВБ');
  const pageId = hash(`${connection.companyId}:${connection.id}:${job.revision}:${init.method ?? 'GET'}:${url}:${String(init.body ?? '')}`);
  const cached = await pool.query(`SELECT payload,status,fetched_at FROM marketplace_sync_pages WHERE id=$1 AND (expires_at>now() OR (status<400 AND fetched_at>=$2))`, [pageId, job.generation]);
  if (cached.rows[0]) {
    if (cached.rows[0].status >= 400) throw new SyncRejected(cached.rows[0].status,JSON.parse(cached.rows[0].payload).reason==='subscription'?'subscription':'other');
    syncContext.getStore()?.sourceTimes?.push(cached.rows[0].fetched_at.getTime());
    return new Response(cached.rows[0].status === 204 ? null : cached.rows[0].payload, { status: cached.rows[0].status, headers: { 'Content-Type': 'application/json' } });
  }
  const budget = hash(`${budgetScope(connection)}:${policy.group}`);
  try {await reserveBudget(budget, policy.interval,policy.group==='ozon:analytics'?50:undefined);}
  catch(error){if(error instanceof SyncDeferred)throw new SyncDeferred(error.retryAt,'budget',`${source}: соблюдаем интервал запросов.`);throw error;}
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), redirect: 'error' }); }
  catch { throw new SyncDeferred(Date.now() + Math.max(60_000,policy.interval), 'network',`${source}: площадка не ответила.`); }
  if (response.status === 429 || response.status === 408 || response.status >= 500) {
    const retryAt = retryAtFromHeaders(response.headers, Date.now(), response.status === 429 ? policy.interval : 60_000);
    const saved = await pool.query('UPDATE marketplace_sync_budgets SET next_allowed_at=GREATEST(next_allowed_at,$2) WHERE id=$1 RETURNING next_allowed_at', [budget, new Date(retryAt)]);
    await response.body?.cancel();
    throw new SyncDeferred(saved.rows[0].next_allowed_at.getTime(), 'provider',`${source}: площадка вернула HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const responseText=await response.text();
    const reason=new URL(url).hostname==='api-seller.ozon.ru' && [400,403].includes(response.status) && /premium|subscription|подписк/i.test(responseText.slice(0,4096))?'subscription':'other';
    if (response.status >= 400 && response.status < 500) {
      const multiplier = new URL(url).hostname.endsWith('.wildberries.ru') ? 10 : 1;
      await pool.query("UPDATE marketplace_sync_budgets SET next_allowed_at=GREATEST(next_allowed_at,now()+$2*interval '1 millisecond') WHERE id=$1", [budget, policy.interval * multiplier]);
      // A bad request/auth failure is terminal for this exact request/revision.
      // Keep other sources refreshing without replaying the failed HTTP call.
      await pool.query(`INSERT INTO marketplace_sync_pages(id,connection_id,revision,payload,status,expires_at) VALUES($1,$2,$3,$5,$4,$6)
        ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at`, [pageId,connection.id,job.revision,response.status,JSON.stringify({reason}),reason==='subscription'?new Date(Date.now()+6*3600_000):new Date('9999-01-01')]);
    }
    // Provider bodies can contain identifiers or credentials; never persist/log them.
    throw new SyncRejected(response.status,reason);
  }
  if (response.headers.get('X-Ratelimit-Remaining') === '0') {
    const retryAt = retryAtFromHeaders(response.headers, Date.now(), policy.interval);
    await pool.query('UPDATE marketplace_sync_budgets SET next_allowed_at=GREATEST(next_allowed_at,$2) WHERE id=$1', [budget, new Date(retryAt)]);
  }
  let payload = response.status === 204 ? '' : await response.text();
  if (response.status !== 204) {
    const parsed=JSON.parse(payload);
    if(new URL(url).pathname==='/v1/seller/info')payload=JSON.stringify(safeSellerInfo(parsed));
  }
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
    deferredMessages:[],
    sourceTimes: [],
    fetch: async (url, init) => {
      try { return await pageFetch(job, connection!, url, init); }
      catch (error) { if (error instanceof SyncDeferred) {context.deferredUntil.push(error.retryAt);context.deferredMessages?.push(error.message);} throw error; }
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
    const sourceAt = new Date(context.sourceTimes?.length ? Math.min(...context.sourceTimes) : Date.now());
    if(job.kind==='subscription'){
      const subscription=value as OzonSubscription;subscription.checkedAt=sourceAt.toISOString();
      if(subscription.advancedAnalytics===true){
        await pool.query(`UPDATE marketplace_sync_pages SET expires_at=now()-interval '1 second' WHERE connection_id=$1 AND revision=$2 AND status>=400 AND NULLIF(payload,'')::jsonb->>'reason'='subscription'`,[connection.id,job.revision]);
        await pool.query(`UPDATE marketplace_sync_jobs SET state='queued',next_attempt_at=now() WHERE connection_id=$1 AND revision=$2 AND state IN ('waiting','blocked') AND last_error='Ozon: данные не загружены из-за ограничения подписки. Требуется Premium Plus или Premium Pro.'`,[connection.id,job.revision]);
      }
    }
    const serialized = packSyncResult(value);
    if (context.deferredUntil.length && job.kind === 'catalog') throw new SyncDeferred(Math.min(...context.deferredUntil));
    if (context.deferredUntil.length) {
      await pool.query(`UPDATE marketplace_sync_jobs SET partial_result=$3,state='waiting',next_attempt_at=$4,updated_at=CASE WHEN result IS NULL THEN $5 ELSE updated_at END,lease_until=NULL,lease_token=NULL,last_error=$6 WHERE id=$1 AND lease_token=$2`, [job.id, token, serialized, new Date(Math.min(...context.deferredUntil)),sourceAt,context.deferredMessages?.at(-1)??null]);
    } else {
      const ttl = job.kind==='subscription'?3600_000:job.kind === 'snapshot' ? 2 * 3600_000 : job.kind === 'finance' ? 12 * 3600_000 : 6 * 3600_000;
      await pool.query(`UPDATE marketplace_sync_jobs SET result=$3,partial_result=NULL,state='ready',updated_at=$5,next_attempt_at=$4,lease_until=NULL,lease_token=NULL,failures=0,last_error=NULL WHERE id=$1 AND lease_token=$2`, [job.id, token, serialized, new Date(Math.max(Date.now()+5000, sourceAt.getTime()+ttl)), sourceAt]);
      await pool.query('UPDATE marketplace_connections SET last_sync_at=GREATEST(last_sync_at,$2) WHERE id=$1', [connection.id,sourceAt]);
    }
  } catch (error) {
    const subscription=error instanceof SyncRejected && error.reason==='subscription';
    const deferred = error instanceof SyncDeferred || context.deferredUntil.length > 0 || subscription;
    const failures = subscription ? 0 : error instanceof SyncDeferred && error.reason === 'budget' ? job.failures : job.failures + 1;
    const retryAt = subscription ? Date.now()+6*3600_000 : error instanceof SyncDeferred ? error.retryAt : context.deferredUntil.length ? Math.min(...context.deferredUntil) : Date.now() + 3600_000;
    console.warn('Marketplace dataset deferred or blocked', { connectionId: job.connection_id, kind: job.kind, deferred, failures });
    await pool.query(`UPDATE marketplace_sync_jobs SET state=$3,next_attempt_at=$4,lease_until=NULL,lease_token=NULL,failures=$5,last_error=$6 WHERE id=$1 AND lease_token=$2`,
      [job.id, token, deferred ? 'waiting' : 'blocked', new Date(Math.max(retryAt, failures > 8 ? Date.now() + 24 * 3600_000 : 0)), failures,
        subscription ? error.message : deferred ? context.deferredMessages?.at(-1)??(error instanceof SyncDeferred?error.message:'Ожидание доступного интервала площадки.') : error instanceof SyncRejected ? error.message : error instanceof Error && /^(Ozon|ВБ):/.test(error.message) ? error.message : 'Не удалось обработать ответ площадки.']);
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
