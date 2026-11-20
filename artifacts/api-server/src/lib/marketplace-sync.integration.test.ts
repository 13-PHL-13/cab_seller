import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

test('PostgreSQL queue survives restart, shares pages, honours 429 and credential rotation', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/marketplace_sync_test', 'Use only the dedicated ephemeral CI database');
  process.env.DATABASE_URL = url.toString();
  process.env.SESSION_SECRET = 'isolated-sync-test-fixture';
  const { pool } = await import('@workspace/db');
  const { encryptCredentials } = await import('./marketplace-credentials.ts');
  const { ensureMarketplaceSyncSchema, sharedDataset, sharedSnapshot, startMarketplaceSync, workOne } = await import('./marketplace-sync.ts');
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
    finance: async () => ({ value: 1 }), catalog: async () => [], buyouts:async()=>({daily:new Map()}),subscription:async()=>({type:"UNKNOWN",isPremium:null,advancedAnalytics:null,label:"Unknown",checkedAt:null}),
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
    assert.match((await pool.query("SELECT last_error FROM marketplace_sync_jobs WHERE state='waiting' ORDER BY next_attempt_at DESC LIMIT 1")).rows[0].last_error,/HTTP 429/);
    // Rotated credentials cannot read the old result. Updating lastSyncAt can.
    await assert.rejects(sharedDataset({...connection,credentialsCiphertext:encryptCredentials({apiKey:'rotated-fixture'})},'snapshot',{from:'a',to:'b'}),SyncDeferred);
    // A terminal failure in one source must not stop good sources refreshing,
    // and its HTTP request must never be automatically replayed.
    await pool.query('TRUNCATE marketplace_sync_jobs,marketplace_sync_pages,marketplace_sync_budgets');
    let terminalCalls=0;
    t.mock.method(globalThis,'fetch',async(url:string)=>{
      terminalCalls++;
      return url.includes('/supplier/sales') ? new Response('secret must not be stored',{status:403}) : new Response('{"value":2}');
    });
    const partialHandlers={...handlers,snapshot:async()=>{
      const results=await Promise.allSettled([
        providerFetch('https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=terminal',{}),
        providerFetch('https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products',{method:'POST',body:'{}'}),
      ]);
      assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');
      return {daily:new Map(),unavailable:{sales:'HTTP 403'}};
    }};
    await sharedDataset(connection,'snapshot',{from:'terminal',to:'terminal'}).catch(()=>{});
    await workOne(partialHandlers);
    assert.equal(terminalCalls,2);
    await pool.query("UPDATE marketplace_sync_jobs SET state='queued',next_attempt_at=now()");
    await workOne(partialHandlers);
    assert.equal(terminalCalls,2);
    assert.equal((await sharedDataset(connection,'snapshot',{from:'terminal',to:'terminal'})).sync.state,'ready');
    assert.equal((await pool.query("SELECT 1 FROM marketplace_sync_pages WHERE payload LIKE '%secret must not be stored%'")).rowCount,0);
    // Subscription can be enabled without rotating the seller key. Retry the
    // subscription gate after its bounded cache interval, not every UI poll.
    await pool.query('TRUNCATE marketplace_sync_jobs,marketplace_sync_pages,marketplace_sync_budgets');
    const ozonCipher=encryptCredentials({clientId:'fixture-ozon',apiKey:'fixture'});
    await pool.query("UPDATE marketplace_connections SET marketplace='ozon',credentials_ciphertext=$2 WHERE id=$1",[connection.id,ozonCipher]);
    const ozon={...connection,marketplace:'ozon',credentialsCiphertext:ozonCipher};
    const {getOzonBuyouts}=await import('./ozon-buyouts.ts');
    const subscriptionHandlers={...handlers,buyouts:()=>getOzonBuyouts({clientId:'fixture-ozon',apiKey:'fixture'},'2026-11-20','2026-11-20')};
    t.mock.method(globalThis,'fetch',async()=>new Response('subscription required; private provider body',{status:403}));
    await sharedDataset(ozon,'buyouts',{from:'2026-11-20',to:'2026-11-20'}).catch(()=>{});
    await workOne(subscriptionHandlers);
    const {SyncRejected}=await import('./sync-context.ts');
    await assert.rejects(sharedDataset(ozon,'buyouts',{from:'2026-11-20',to:'2026-11-20'}),(error:unknown)=>error instanceof SyncRejected && error.reason==='subscription');
    assert.ok((await pool.query("SELECT 1 FROM marketplace_sync_jobs WHERE state='waiting' AND next_attempt_at>now()+interval '5 hours'")).rowCount);
    await pool.query("UPDATE marketplace_sync_pages SET expires_at=now()-interval '1 minute'; UPDATE marketplace_sync_jobs SET next_attempt_at=now(); UPDATE marketplace_sync_budgets SET next_allowed_at=now()-interval '1 minute'");
    t.mock.method(globalThis,'fetch',async()=>new Response('{"rows":[{"delivery_commission":{"quantity":2,"amount":300}}]}'));
    await workOne(subscriptionHandlers);
    const unlocked=await sharedDataset<{daily:Map<string,{units:number}>}>(ozon,'buyouts',{from:'2026-11-20',to:'2026-11-20'});
    assert.equal(unlocked.daily.get('2026-11-20')?.units,2);
    // All analytics dimensions share the durable non-Premium 50/day budget.
    let analyticsCalls=0;
    t.mock.method(globalThis,'fetch',async()=>{analyticsCalls++;return new Response('{}');});
    const quotaHandlers={...subscriptionHandlers,snapshot:async()=>{
      await providerFetch('https://api-seller.ozon.ru/v1/analytics/data',{method:'POST',body:JSON.stringify({case:analyticsCalls?'second':'first'})});
      return {daily:new Map()};
    }};
    await sharedDataset(ozon,'snapshot',{from:'quota-1',to:'quota-1'}).catch(()=>{});await workOne(quotaHandlers);
    await pool.query("UPDATE marketplace_sync_budgets SET request_count=50,request_day=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),next_allowed_at=now()-interval '1 minute' WHERE request_count>0");
    await sharedDataset(ozon,'snapshot',{from:'quota-2',to:'quota-2'}).catch(()=>{});await workOne(quotaHandlers);
    assert.equal(analyticsCalls,1);
    // The exact plan comes from seller/info, not from a guessed access error.
    // Upgrading releases only subscription gates, while the raw seller-info
    // company/tax/ratings fields never enter the page cache or dataset result.
    await pool.query("UPDATE marketplace_sync_jobs SET state='waiting',next_attempt_at=now()+interval '6 hours',last_error='Ozon: данные не загружены из-за ограничения подписки. Требуется Premium Plus или Premium Pro.' WHERE connection_id=$1 AND kind='buyouts'",[ozon.id]);
    const {getOzonSubscription}=await import('./ozon-subscription.ts');
    const planHandlers={...quotaHandlers,subscription:()=>getOzonSubscription({clientId:'fixture-ozon',apiKey:'fixture'})};
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({company:{inn:'private-company-tax-id',legal_name:'private-company-name'},ratings:[{premium:true}],subscription:{type:'PREMIUM_PLUS',is_premium:true}})));
    await sharedDataset(ozon,'subscription',{}).catch(()=>{});await workOne(planHandlers);
    const plan=await sharedDataset<{type:string;advancedAnalytics:boolean;checkedAt:string}>(ozon,'subscription',{});
    assert.equal(plan.type,'PREMIUM_PLUS');assert.equal(plan.advancedAnalytics,true);assert.ok(plan.checkedAt);
    assert.ok((await pool.query("SELECT 1 FROM marketplace_sync_jobs WHERE connection_id=$1 AND kind='buyouts' AND state='queued'",[ozon.id])).rowCount);
    assert.equal((await pool.query("SELECT 1 FROM marketplace_sync_pages WHERE payload LIKE '%private-company%' UNION ALL SELECT 1 FROM marketplace_sync_jobs WHERE result LIKE '%private-company%'")).rowCount,0);
    // A previous deployment worker cannot leave an old finance result marked
    // ready after the new schema migration (zero-downtime deployment overlap).
    await pool.query('TRUNCATE marketplace_sync_jobs,marketplace_sync_pages,marketplace_sync_budgets');
    await sharedDataset(ozon,'finance',{from:'rollout',to:'rollout'}).catch(()=>{});
    await workOne(planHandlers);
    const oldFinance=await sharedDataset(ozon,'finance',{from:'rollout',to:'rollout'});
    assert.equal(oldFinance.sync.state,'queued');
    await workOne({...planHandlers,finance:async()=>({value:2,dashboardVersion:8,dashboardDiagnostics:{postingRows:0}})});
    assert.equal((await sharedDataset(ozon,'finance',{from:'rollout',to:'rollout'})).sync.state,'ready');
    // WB daily history resumes one permitted request at a time, retaining
    // its period totals and successful sales while a later day is deferred.
    await pool.query('TRUNCATE marketplace_sync_jobs,marketplace_sync_pages,marketplace_sync_budgets');
    await pool.query("UPDATE marketplace_connections SET marketplace='wildberries',credentials_ciphertext=$2 WHERE id=$1",[connection.id,ciphertext]);
    const {getWildberriesSnapshot}=await import('./marketplace-data.ts');
    const {dashboardStoreData}=await import('./dashboard-layout.ts');
    const day=new Date().toISOString().slice(0,10),prior=new Date(Date.now()-86400000).toISOString().slice(0,10);
    let wbCalls=0;
    t.mock.method(globalThis,'fetch',async(url:string)=>{
      wbCalls++;
      return new Response(url.includes('/supplier/sales')?'[]':JSON.stringify({data:{products:[{statistics:{selected:{openCount:10,cartCount:3,orderCount:2,buyoutCount:1,orderSum:200}}}]}}));
    });
    const wbHandlers={...handlers,snapshot:()=>getWildberriesSnapshot({apiKey:'fixture'},prior,day,true)};
    await sharedDataset(connection,'snapshot',{from:prior,to:day}).catch(()=>{});
    await workOne(wbHandlers);
    let wbData=dashboardStoreData(await sharedDataset(connection,'snapshot',{from:prior,to:day}),'wildberries');
    assert.equal(wbData.totals.orders,2);assert.ok(wbData.daily.every(p=>p.orders===null));
    for(let attempt=0;attempt<2;attempt++){
      await pool.query("UPDATE marketplace_sync_budgets SET next_allowed_at=now()-interval '1 minute'; UPDATE marketplace_sync_jobs SET next_attempt_at=now()");
      await workOne(wbHandlers);
    }
    wbData=dashboardStoreData(await sharedDataset(connection,'snapshot',{from:prior,to:day}),'wildberries');
    assert.ok(wbData.daily.every(p=>p.orders===2&&p.views===10));
    assert.equal(wbCalls,4); // one period, one sales feed, two daily pages
    const tomorrow = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
    const shifted = dashboardStoreData(await sharedSnapshot(connection, day, tomorrow), 'wildberries');
    assert.equal(shifted.totals.orders, null); // older period totals never cross the boundary
    assert.equal(shifted.daily.find(point => point.date === day)?.orders, 2);
    assert.equal(shifted.daily.some(point => point.date === tomorrow && point.orders !== null), false);
    assert.equal(shifted.totals.bought, null);
    assert.equal(wbCalls, 4); // reading the replacement window does not call WB

    // On startup, a failed refresh must not prevent already queued work
    // from running. Jobs whose persisted deadline is in the future still wait.
    await pool.query('TRUNCATE marketplace_sync_jobs,marketplace_sync_pages,marketplace_sync_budgets');
    await assert.rejects(sharedDataset(connection, 'finance', { from: 'overdue' }), SyncDeferred);
    await assert.rejects(sharedDataset(connection, 'finance', { from: 'future' }), SyncDeferred);
    await pool.query("UPDATE marketplace_sync_jobs SET state='waiting',next_attempt_at=CASE WHEN params->>'from'='future' THEN now()+interval '30 minutes' ELSE now()-interval '1 minute' END");
    const originalQuery = pool.query;
    let seedFailed = false;
    const queryMock = t.mock.method(pool, 'query', function (...args: Parameters<typeof originalQuery>) {
      if (typeof args[0] === 'string' && args[0].includes("marketplace IN ('ozon','wildberries')")) {
        seedFailed = true;
        return Promise.reject(new Error('Fixture: scheduler query failed'));
      }
      return Reflect.apply(originalQuery, pool, args);
    });
    const stop = startMarketplaceSync(handlers);
    try {
      const deadline = Date.now() + 5000;
      const getJobs = () => pool.query("SELECT params->>'from' AS period, state FROM marketplace_sync_jobs ORDER BY period");
      let jobs = await getJobs();
      while (jobs.rows[1]?.state !== 'ready' && Date.now() < deadline) {
        await delay(25);
        jobs = await getJobs();
      }
      assert.equal(seedFailed, true);
      assert.deepEqual(jobs.rows, [
        { period: 'future', state: 'waiting' },
        { period: 'overdue', state: 'ready' },
      ]);
    } finally {
      stop();
      queryMock.mock.restore();
    }
  } finally { await pool.end(); }
});
