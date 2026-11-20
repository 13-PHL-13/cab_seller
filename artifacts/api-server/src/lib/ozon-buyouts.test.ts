import test from 'node:test';
import assert from 'node:assert/strict';
import {realizationDay,getOzonBuyouts} from './ozon-buyouts.ts';
import {getOzonSnapshot,type MarketplaceSnapshot} from './marketplace-data.ts';
import {dashboardStoreData} from './dashboard-layout.ts';
import {syncContext,SyncRejected} from './sync-context.ts';

test('financial buyouts use realization quantities and amounts, never orders or payouts',()=>{
  assert.deepEqual(realizationDay([{delivery_commission:{quantity:3,amount:250},return_commission:{quantity:1,amount:70}},{delivery_commission:{quantity:2,amount:150}}]),{units:5,amount:400});
  assert.deepEqual(realizationDay([]),{units:0,amount:0});
  assert.deepEqual(realizationDay([{delivery_commission:{quantity:2}}]),{units:2,amount:null});
  assert.throws(()=>realizationDay([{delivery_commission:{amount:100}}]),/количество/);
});
test('realization report date maps exactly to its own calendar day',async(t)=>{
  const dates:unknown[]=[];
  t.mock.method(globalThis,'fetch',async(_url:string,init:RequestInit)=>{
    dates.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({rows:[{delivery_commission:{quantity:2,amount:500}}]}));
  });
  const data=await getOzonBuyouts({clientId:'fixture',apiKey:'fixture'},'2026-11-18','2026-11-19');
  assert.deepEqual(dates,[{day:19,month:11,year:2026},{day:18,month:11,year:2026}]);
  assert.equal(data.daily.get('2026-11-18')?.units,2);
});
test('a subscription rejection cannot erase the basic Ozon metrics',async()=>{
  const bodies:string[][]=[];
  const data=await syncContext.run({deferredUntil:[],fetch:async(_url,init)=>{
    const body=JSON.parse(String(init.body));bodies.push(body.metrics);
    if(body.metrics.length>2)throw new SyncRejected(403,'subscription');
    return new Response(JSON.stringify({result:{data:[{dimensions:[{id:'2026-11-20'}],metrics:[900,4]}]}}));
  }},()=>getOzonSnapshot({clientId:'fixture',apiKey:'fixture'},'2026-11-20','2026-11-20'));
  const normalized=dashboardStoreData(data,'ozon');
  assert.equal(normalized.totals.orders,4);assert.equal(normalized.totals.orderAmount,900);
  assert.equal(normalized.totals.views,null);assert.match(data.unavailable?.views??'',/Premium Plus/);
  assert.deepEqual(bodies[1],['revenue','ordered_units']);
});
test('buyouts populate both the totals and the daily chart, while partial coverage stays unknown',()=>{
  const snapshot:MarketplaceSnapshot={daily:new Map([['2026-11-20',{date:'2026-11-20',orders:10,revenue:1000,units:0,views:20,cartAdds:5,boughtUnits:3,boughtAmount:240}]]),funnel:{orders:10,units:0,views:20,cartAdds:5}};
  const complete=dashboardStoreData(snapshot,'ozon');
  assert.equal(complete.totals.bought,3);assert.equal(complete.totals.boughtAmount,240);assert.equal(complete.daily[0].bought,3);
  const partial=dashboardStoreData({...snapshot,daily:new Map([...snapshot.daily,['2026-11-19',{date:'2026-11-19',orders:0,revenue:0,units:0,views:0,cartAdds:0,boughtUnits:null,boughtAmount:null}]])},'ozon');
  assert.equal(partial.totals.bought,null);assert.equal(partial.daily[0].bought,3);
});
