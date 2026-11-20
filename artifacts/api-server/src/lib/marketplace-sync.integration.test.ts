import test from 'node:test';
import assert from 'node:assert/strict';

test('PostgreSQL queue survives restart, shares pages, honours 429 and credential rotation', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/marketplace_sync_test', 'Use only the dedicated ephemeral CI database');
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET = 'isolated-sync-test-fixture';
  const { pool } = await import('@workspace/db');
  const { encryptCredentials } = await import('./marketplace-credentials.ts');
  const { ensureMarketplaceSyncSchema, sharedDataset, workOne } = await import('./marketplace-sync.ts');
  const { providerFetch, SyncDeferred } = await import('./sync-context.ts');
  await pool.query(`CREATE TABLE marketplace_connections(id serial PRIMARY KEY,company_id uuid NOT NULL,marketplace text NOT NULL,store_name text NOT NULL,credentials_ciphertext text NOT NULL,last_sync_at timestamptz)`);
  await ensureMarketplaceSyncSchema();
  const companyId = '00000000-0000-0000-0000-000000000001';
  const ciphertext = encryptCredentials({ apiKey: 'fixture-basic-opaque' });
  const inserted = await pool.query(`INSERT INTO marketplace_connections(company_id,marketplace,store_name,credentials_ciphertext) VALUES($1,'wildberries','fixture',$2) RETURNING id`, [companyId,ciphertext]);
  const connection = { id: inserted.rows[0].id, companyId, marketplace: 'wildberries', storeName: 'fixture', credentialsCiphertext: ciphertext } as Parameters<typeof sharedDataset>[0];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ value: 7 })); });
  const handlers = {
    snapshot: async () => ({ daily: new Map([['day', await (await providerFetch('https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=fixture', {})).json()]]) }),
    finance: async () => ({ value: 1 }), catalog: async () => [],
  };
  try {
    await assert.rejects(sharedDataset(connection, 'snapshot', { from: 'a', to: 'b' }), SyncDeferred);
    await Promise.all([sharedDataset(connection,'snapshot',{from:'a',to:'b'}).catch(()=>{}),sharedDataset(connection,'snapshot',{from:'a',to:'b'}).catch(()=>{})]);
    assert.equal(Number((await pool.query('SELECT count(*) FROM marketplace_sync_jobs')).rows[0].count),1);
    await workOne(handlers);
    const restored = await sharedDataset<{daily:Map<string,{value:number}>}>(connection,'snapshot',{from:'a',to:'b'});
    assert.equal(restored.daily.get('day')?.value,7);
    assert.equal(calls,1);
    // A second consumer/period reuses the persisted page, even with fresh handlers.
    await sharedDataset(connection,'snapshot',{from:'c',to:'d'}).catch(()=>{});
    await workOne({...handlers});
    assert.equal(calls,1);
    // Expired worker leases are recovered without losing saved pages.
    await pool.query("UPDATE marketplace_sync_jobs SET state='running',lease_until=now()-interval '1 minute',lease_token='dead-process'");
    await workOne({...handlers});
    assert.equal(calls,1);
    // New uncached page must wait for the persisted seller budget.
    const delayedHandlers = {...handlers, snapshot: async () => providerFetch('https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=other', {})};
    await pool.query("UPDATE marketplace_sync_jobs SET state='queued',next_attempt_at=now()");
    await workOne(delayedHandlers);
    assert.equal(calls,1);
    assert.ok((await pool.query("SELECT 1 FROM marketplace_sync_jobs WHERE state='waiting' AND next_attempt_at>now()+interval '1 hour'")).rowCount);
    // A provider 429 extends the durable budget; recreating a worker cannot bypass it.
    await pool.query("UPDATE marketplace_sync_budgets SET next_allowed_at=now()-interval '1 minute'");
    await pool.query("UPDATE marketplace_sync_jobs SET state='queued',next_attempt_at=now()");
    t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'10800'}});});
    await workOne(delayedHandlers);
    assert.ok((await pool.query("SELECT 1 FROM marketplace_sync_budgets WHERE next_allowed_at>now()+interval '2 hours'")).rowCount);
    assert.equal(calls,2);
    // Rotated credentials cannot read the old result. Updating lastSyncAt can.
    await assert.rejects(sharedDataset({...connection,credentialsCiphertext:encryptCredentials({apiKey:'rotated-fixture'})},'snapshot',{from:'a',to:'b'}),SyncDeferred);
  } finally { await pool.end(); }
});
