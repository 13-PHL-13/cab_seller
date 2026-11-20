import test from 'node:test';
import assert from 'node:assert/strict';
import { getWildberriesSnapshot, getOzonSnapshot } from './marketplace-data.ts';
import { dashboardStoreData } from './dashboard-layout.ts';

const today=new Date().toISOString().slice(0,10);
const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
const funnel={data:{products:[{statistics:{selected:{openCount:20,cartCount:8,orderCount:5,buyoutCount:3}}}]}};

test('WB funnel continues after the first 1000 products',async(t)=>{
  const offsets:number[]=[];
  t.mock.method(globalThis,'fetch',async(url:string,init?:RequestInit)=>{
    if(url.includes('/supplier/sales'))return new Response('[]');
    const offset=JSON.parse(String(init?.body)).offset;offsets.push(offset);
    return new Response(JSON.stringify({data:{products:Array.from({length:offset===0?1000:1},()=>({statistics:{selected:{openCount:1,cartCount:0,orderCount:0,buyoutCount:0}}}))}}));
  });
  const data=await getWildberriesSnapshot({apiKey:'fixture-pagination'},today,today);
  assert.deepEqual(offsets,[0,1000]);assert.equal(data.funnel.views,1001);
});

test('Ozon missing metrics remain null while available metrics survive',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({result:{data:[{dimensions:[{id:today}],metrics:[100,null,5,2]}]}})));
  const data=dashboardStoreData(await getOzonSnapshot({clientId:'fixture',apiKey:'fixture'},today,today),'ozon');
  assert.equal(data.totals.orders,null);assert.equal(data.daily[0].orders,null);
  assert.equal(data.totals.orderAmount,100);assert.equal(data.totals.views,5);assert.equal(data.totals.carts,2);
});
test('WB sales rows have no quantity: count sold units, exclude returns, fill verified zero days',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url:string)=>new Response(JSON.stringify(url.includes('/supplier/sales') ? [
    {date:today,saleID:'S1',finishedPrice:100},
    {date:today,saleID:'S2',finishedPrice:50},
    {date:today,saleID:'R1',finishedPrice:100},
  ] : funnel),{status:200}));
  const snapshot=await getWildberriesSnapshot({apiKey:'test-sales'},yesterday,today);
  assert.equal(snapshot.daily.get(today)?.units,2);
  assert.equal(snapshot.daily.get(today)?.revenue,150);
  assert.equal(snapshot.daily.get(yesterday)?.units,0);
  assert.equal(dashboardStoreData(snapshot,'wildberries').totals.bought,2);
});
test('concurrent dashboard windows share the WB sales feed',async(t)=>{
  let salesCalls=0;
  t.mock.method(globalThis,'fetch',async(url:string)=>{
    if(url.includes('/supplier/sales'))salesCalls++;
    await Promise.resolve();
    return new Response(JSON.stringify(url.includes('/supplier/sales')?[]:funnel),{status:200});
  });
  await Promise.all([getWildberriesSnapshot({apiKey:'test-shared'},today,today),getWildberriesSnapshot({apiKey:'test-shared'},yesterday,yesterday)]);
  assert.equal(salesCalls,1);
});
test('a funnel failure does not discard successful sales; unavailable metrics stay null',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url:string)=>url.includes('/supplier/sales') ? new Response(JSON.stringify([{date:today,saleID:'S3',finishedPrice:80}])) : new Response('',{status:429,headers:{'X-Ratelimit-Retry':'20'}}));
  const snapshot=await getWildberriesSnapshot({apiKey:'test-funnel-fails'},today,today,true);
  const data=dashboardStoreData(snapshot,'wildberries');
  assert.equal(data.totals.views,null);assert.equal(data.totals.carts,null);
  assert.equal(data.totals.boughtAmount,80);assert.ok(snapshot.unavailable?.funnel);
});
test('sales 429 retains the funnel and suppresses repeated calls until retry time',async(t)=>{
  let salesCalls=0;
  t.mock.method(globalThis,'fetch',async(url:string)=>{
    if(url.includes('/supplier/sales')){salesCalls++;return new Response('',{status:429,headers:{'Retry-After':'60'}});}
    return new Response(JSON.stringify(funnel));
  });
  const first=await getWildberriesSnapshot({apiKey:'test-sales-fails'},today,today,true);
  const second=await getWildberriesSnapshot({apiKey:'test-sales-fails'},yesterday,today,true);
  assert.equal(salesCalls,1);
  for(const snapshot of [first,second]){
    const data=dashboardStoreData(snapshot,'wildberries');
    assert.equal(data.totals.views,20);assert.equal(data.totals.bought,null);
    assert.equal(data.totals.boughtAmount,null);assert.equal(data.daily.length,0);
  }
});


test('Ozon unavailable views do not erase orders or masquerade as zero views',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({result:{data:[{dimensions:[{id:today}],metrics:[100,3,null,null]}]}})));
  const data=dashboardStoreData(await getOzonSnapshot({clientId:'fixture',apiKey:'fixture'},today,today),'ozon');
  assert.equal(data.totals.orders,3);assert.equal(data.totals.orderAmount,100);
  assert.equal(data.totals.views,null);assert.equal(data.daily[0].views,null);assert.equal(data.totals.carts,null);
});
