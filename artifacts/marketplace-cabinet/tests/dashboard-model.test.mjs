import test from 'node:test';
import assert from 'node:assert/strict';
import { completeSum,change,calendarDays,metricCoverage,metricSum,sameMetricCohort,chartCoverage,dailyMetricSum,sameDailyMetricCohort } from '../src/lib/dashboard-model.ts';
import {previousFinancePeriod,financePeriodAmounts,financeComparisonBaseline} from '../src/lib/finance-comparison.ts';
import { platformPeriodMetric } from '../src/lib/dashboard-model.ts';

test('WB shows saved days as partial without replacing official totals or filling missing days', () => {
 const [store] = [{ id: 1, storeName: 'WB', marketplace: 'wildberries' }];
 const window = { from: '2026-11-20', to: '2026-11-22', stores: [{
   ...store, data: { totals: { orders: null }, daily: [{date: '2026-11-20', orders: 3}, {date: '2026-11-21', orders: 0}, {date: '2026-11-22', orders: null}] },
 }] };
 assert.deepEqual(platformPeriodMetric([store], window, 'orders', true), { value: 3, partial: true });
 assert.deepEqual(platformPeriodMetric([store], window, 'orders', false), { value: null, partial: false });
 window.stores[0].data.totals.orders = 5;
 assert.deepEqual(platformPeriodMetric([store], window, 'orders', true), { value: 5, partial: false });
});

test('monthly finance compares matched elapsed days including year boundaries and shorter months',()=>{
 assert.deepEqual(previousFinancePeriod('2026-11-20'),{from:'2026-10-01',to:'2026-10-20',sourceTo:'2026-10-31',comparable:true});
 assert.equal(previousFinancePeriod('2026-01-20').from,'2025-12-01');
 assert.equal(previousFinancePeriod('2024-03-29').comparable,true);
 assert.equal(previousFinancePeriod('2026-03-31').comparable,false);
});

test('finance projections never compare a partial month against a full month or mismatched stores',()=>{
 const amounts=(revenue,expenses)=>({revenue,expenses,commission:0,logistics:0,other:0});
 const report={from:'2026-10-01',to:'2026-10-31',dashboard:amounts(9999,9999),dailyDashboard:[{date:'2026-10-01',...amounts(100,50)},{date:'2026-10-02',...amounts(200,70)}]};
 assert.deepEqual(financePeriodAmounts(report,'2026-10-01','2026-10-02'),amounts(300,120));
 assert.equal(financePeriodAmounts(report,'2026-10-01','2026-10-03'),undefined);
 const broken=structuredClone(report);broken.dailyDashboard[0].revenue=null;
 assert.equal(financePeriodAmounts(broken,'2026-10-01','2026-10-02').revenue,null);
 const stores=[{id:1},{id:2}],current={1:{revenue:150},2:{revenue:null}},past={1:{revenue:100},2:{revenue:null}};
 assert.equal(financeComparisonBaseline(stores,current,past,'revenue'),100);
 assert.equal(change(150,financeComparisonBaseline(stores,current,past,'revenue')),50);
 assert.equal(financeComparisonBaseline(stores,{...current,2:{revenue:30}},past,'revenue'),null);
 assert.equal(change(150,financeComparisonBaseline(stores,current,{1:{revenue:0}},'revenue')),null);
});

test('platform charts retain available daily values and real zeroes without filling gaps or relaxing aggregate coverage',()=>{
 const stores=[{id:1,storeName:'A',marketplace:'wildberries'},{id:2,storeName:'B',marketplace:'wildberries'}];
 const day='2026-11-20';
 const window={from:day,to:day,stores:stores.map((store,index)=>({...store,data:{totals:{orders:index===0?5:null},daily:[{date:day,orders:index===0?5:null,bought:null}]}}))};
 window.stores[1].data.daily.push({date:'2026-11-19',orders:3,bought:null});
 assert.equal(dailyMetricSum(stores,window,day,'orders',true),5);
 assert.equal(dailyMetricSum(stores,window,day,'orders'),null);
 assert.equal(dailyMetricSum(stores,window,day,'bought',true),null);
 assert.equal(dailyMetricSum(stores,window,'2026-11-18','orders',true),null);
 window.stores[0].data.daily[0].orders=0;
 assert.equal(dailyMetricSum(stores,window,day,'orders',true),0);
 assert.deepEqual(chartCoverage(stores,window,['orders','bought']).included,[]);
 assert.equal(sameDailyMetricCohort(stores,window,window,day,day,'orders'),true);
 const previous=structuredClone(window);previous.stores[1].data.daily[0].orders=3;
 assert.equal(sameDailyMetricCohort(stores,window,previous,day,day,'orders'),false);
});

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


test('store finance retains expenses with missing profit inputs and signed adjustments', async()=>{
 const {storeFinanceBars}=await import('../src/lib/store-finance-model.ts');
 const bars=storeFinanceBars([172763,null,185713.7,null,null,null]);
 assert.deepEqual(bars[2],{value:185713.7,from:0,to:185713.7});
 assert.deepEqual(bars[1],{value:null,from:0,to:0});
 assert.deepEqual(storeFinanceBars([0,-250,Infinity])[1],{value:-250,from:0,to:-250});
 assert.equal(storeFinanceBars([0,-250,Infinity])[0].value,0);
 assert.equal(storeFinanceBars([0,-250,Infinity])[2].value,null);
 assert.ok(storeFinanceBars([null,null]).every(bar=>bar.value===null));
});
