import test from 'node:test';
import assert from 'node:assert/strict';
import { completeSum,change,calendarDays,metricCoverage,metricSum,sameMetricCohort,chartCoverage } from '../src/lib/dashboard-model.ts';

test('a combined chart uses one complete store cohort for every stage and every day',()=>{
 const store=id=>({id,storeName:String(id),marketplace:id===1?'ozon':'wildberries'});
 const stores=[store(1),store(2)];
 const point={date:'2026-11-20',views:10,carts:2,orders:1,bought:0};
 const window={from:point.date,to:point.date,stores:stores.map(s=>({...s,data:{totals:{...point},daily:[{...point}]}}))};
 window.stores[0].data.totals.views=null;window.stores[0].data.daily[0].views=null;
 const metrics=['views','carts','orders','bought'];
 assert.deepEqual(chartCoverage(stores,window,metrics).included,[stores[1]]);
 assert.equal(metricSum(chartCoverage(stores,window,metrics).included,window,'orders'),1);
 window.stores[1].data.daily=[];
 assert.deepEqual(chartCoverage(stores,window,metrics).included,[]);
 assert.equal(metricSum(chartCoverage(stores,window,metrics).included,window,'orders'),null);
});
test('aggregate is unavailable when any selected store is missing, while a verified zero stays zero',()=>{
 assert.equal(completeSum([]),null);assert.equal(completeSum([100,null]),null);assert.equal(completeSum([100,undefined]),null);assert.equal(completeSum([NaN,3]),null);assert.equal(completeSum([0,0]),0);assert.equal(completeSum([12,8]),20);
});
test('a comparison does not invent a previous baseline or divide by zero',()=>{
 assert.equal(change(10,null),null);assert.equal(change(null,10),null);assert.equal(change(10,0),null);assert.equal(change(120,100),20);assert.equal(change(80,100),-20);
});
test('calendar axis includes exactly the real dates, including a leap day and month boundary',()=>{
 assert.deepEqual(calendarDays('2024-02-28','2024-03-01'),['2024-02-28','2024-02-29','2024-03-01']);assert.equal(calendarDays('2026-11-07','2026-11-20').length,14);
});
test('partial totals keep available stores and disclose unavailable or unsupported sources',()=>{
 const stores=[{id:1,storeName:'A',marketplace:'ozon'},{id:2,storeName:'B',marketplace:'wildberries'}];
 const current={stores:[{...stores[0],data:{totals:{orders:12,bought:null},daily:[{date:'2026-11-20',orders:12,bought:null}]}}]};
 assert.equal(metricSum(stores,current,'orders'),12);
 assert.deepEqual(metricCoverage(stores,current,'orders').excluded,[stores[1]]);
 assert.equal(metricSum(stores,current,'bought'),null);
 assert.equal(metricSum(stores,undefined,'orders'),null);
 const previous={stores:[{...stores[1],data:{totals:{orders:9},daily:[{date:'2026-11-06',orders:9}]}}]};
 assert.equal(sameMetricCohort(stores,current,previous,'orders'),false);
 assert.equal(sameMetricCohort(stores,current,current,'orders'),true);
 assert.equal(sameMetricCohort(stores,current,current,'bought'),false);
});
