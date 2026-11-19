import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImport,parseCsv,effectiveCost,mergeCosts,allocateDelivery,calculateAllocatedBatch,scenario,validApproval,demoCostState,COMPONENTS} from '../src/commerce/costs-model.js';
import {validateManualImport,MANUAL_HEADERS,priceCosts} from '../src/commerce/costs-manual.js';
import {unitRows,summarize,groupKey,setMatch,detachMatch,dateRange,exportRows} from '../src/commerce/unit-model.js';
import {xlsxBytes} from '../src/commerce/unit-xlsx.js';
test('import preserves leading zeros and a genuine zero; errors prevent partial application',()=>{
 const result=validateImport(parseCsv('\uFEFFАртикул продавца;Себестоимость\n0001;0\n"A;2";"1 200,50"'));
 assert.deepEqual(result.items,[{sku:'0001',cost:0},{sku:'A;2',cost:1200.5}]);
 assert.equal(validateImport([['Артикул продавца','Себестоимость'],['x',-1],['y',10],['y',20]]).errors.length,2);
 assert.throws(()=>validateImport([['Wrong','Header'],['x',1]]));
});
test('supplier template requires all three fields and rejects missing or fractional quantities',()=>{
 assert.equal(validateManualImport([MANUAL_HEADERS,['0001','100,25',7]]).items[0].qty,7);
 for(const qty of ['',0,-1,1.5])assert.equal(validateManualImport([MANUAL_HEADERS,['x',100,qty]]).errors.length,1);
});
test('allocation reconciles cents, quantity and value; blank draft rows do not become goods',()=>{
 assert.deepEqual(allocateDelivery(.01,[1,1,1]),[.01,0,0]);
 const rows=[{id:'a',sku:'a',qty:2,values:{purchase:100}},{id:'b',sku:'b',qty:1,values:{purchase:400}},{id:'blank',sku:'',qty:1,values:{purchase:''}}];
 const result=calculateAllocatedBatch(rows,COMPONENTS,{labels:{total:90,mode:'quantity'},bags:{total:60,mode:'value'}});
 assert.deepEqual(result.map(r=>r.unitCost),[140,470]);assert.equal(result.reduce((n,r)=>n+r.batchCost,0),750);
 assert.throws(()=>calculateAllocatedBatch([{id:'x',sku:'x',qty:1,values:{purchase:0}}],COMPONENTS,{delivery:{total:10,mode:'value'}}));
});
test('platform overrides survive common updates, and the draft feeds prices without mutating records',()=>{
 let records=mergeCosts([],[{sku:'x',cost:100}],'all');records=mergeCosts(records,[{sku:'x',cost:130}],'wb');records=mergeCosts(records,[{sku:'x',cost:90}],'all');
 assert.equal(effectiveCost(records,'x','wb').cost,130);assert.equal(effectiveCost(records,'x','ozon').cost,90);
 const state={...demoCostState(),records,rows:[{id:'x',sku:'x',qty:2,values:{purchase:200}}]};
 assert.equal(effectiveCost(priceCosts(state,'all','ozon').records,'x','ozon').cost,200);assert.equal(effectiveCost(records,'x','ozon').cost,90);
});
test('price uses markup on cost, rounds upward, and invalidates the selection after source changes',()=>{
 const v=scenario(503.02,25,330000,1000000);assert.equal(v.price,1905.38);assert.equal(v.breakeven,1524.31);assert.equal(v.profit,125.76);
 assert.equal(scenario(100,25,0,100),null);assert.equal(scenario(100,25,110,100),null);
 assert.equal(validApproval({cost:100,payouts:33,revenue:100,period:'2026-10'},100,{payouts:33,revenue:100,period:'2026-11'}),false);
});
const stores=[{id:'1',platform:'wb'},{id:'2',platform:'ozon'}],listings=stores.map(s=>({id:'p',storeId:s.id,sku:'001',name:'Product'}));
const op=(id,rev)=>({id,storeId:id,listingId:'p',orderDate:'2026-11-01',saleDate:'2026-11-05',orders:2,bought:1,cancellations:0,returns:0,revenue:rev,commission:10,logistics:5,ads:5,other:0});
const base={stores,listings,operations:[op('1',100),op('2',200)],from:'2026-11-01',to:'2026-11-30',costFor:()=>20,settings:{1:{taxRate:0},2:{taxRate:0}}};
test('unit hierarchy reconciles amounts, dates and explicitly matched seller SKUs',()=>{
 const [g]=unitRows(base);assert.equal(g.markets.length,2);assert.equal(g.total.profit,220);assert.equal(g.total.unitProfit,110);
 assert.equal(summarize(g.markets.map(m=>m.total)).profit,g.total.profit);
 assert.equal(unitRows({...base,to:'2026-11-01'})[0].total.bought,0);
 const ls=[listings[0],{...listings[1],sku:'OZ-1'}];let links=setMatch({},ls[1],groupKey(ls[0]));assert.equal(unitRows({...base,listings:ls,links}).length,1);
 links=detachMatch(links,ls[1]);assert.equal(unitRows({...base,listings:ls,links}).length,2);
 assert.throws(()=>dateRange('2026-02-30','2026-03-01'));
});
test('unavailable operations are unknown, while a complete source can contain an actual zero',()=>{
 const [g]=unitRows({...base,operations:[],source:'api'});assert.equal(g.total.revenue,null);assert.equal(g.total.bought,null);assert.equal(g.total.profit,null);assert.equal(g.total.missingCost,0);
 assert.equal(summarize([],true).revenue,null);assert.equal(summarize([]).revenue,0);
 assert.equal(unitRows({...base,source:'api',settings:{}})[0].total.profit,null);
 assert.equal(unitRows({...base,costFor:()=>null})[0].total.profit,null);
 assert.equal(demoCostState().rows.length,0);assert.equal(demoCostState().finance.wb.revenue,null);
});
test('monthly overhead is allocated before product filtering and no cost is counted twice',()=>{
 const operations=[op('1',100),{...op('1',200),id:'second',listingId:'q'}];
 const groups=unitRows({...base,listings:[listings[0],{...listings[0],id:'q',sku:'002'}],operations,settings:{1:{taxRate:0,monthly:{'2026-11':100.01}}}});
 assert.equal(summarize(groups.map(g=>g.total)).extra,100.01);
 assert.equal(groups[0].total.extra,33.34);
});
test('Excel export keeps SKU text and never converts a cell to an executable formula',()=>{
 const rows=exportRows(unitRows(base));assert.equal(rows[1][1],'001');
 const bytes=xlsxBytes([['001','=HYPERLINK("x")','<unsafe>']]),text=new TextDecoder().decode(bytes);
 assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);assert.ok(text.includes('t="inlineStr"'));assert.ok(!text.includes('<f>'));assert.ok(text.includes('&lt;unsafe&gt;'));
});
