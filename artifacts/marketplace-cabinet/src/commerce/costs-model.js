// Preserved from the approved Dashboard-node-v1 prototype.
export const COST_KEY='navigator-demo-costs-v1';
export const SCENARIOS=[5,8,10,15,20,25,30,35,40];
export const COMPONENTS=[{id:'purchase',label:'Стоимость закупки (производства)'},{id:'labels',label:'Этикетки'},{id:'bags',label:'Пакеты'},{id:'fulfillment',label:'Фулфилмент'},{id:'delivery',label:'Доставка'}];
export const AVITO_COMPONENTS=[...COMPONENTS.slice(0,4),{id:'toff',label:'Доставка до ФФ'},{id:'manager',label:'Менеджер продвижения'},{id:'storage',label:'Хранение'},COMPONENTS.at(-1)];
export const scopes=['all','wb','ozon'];
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function number(value){
 if(typeof value==='number')return Number.isFinite(value)?value:NaN;
 const s=String(value??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
 return s!==''&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)?Number(s):NaN;
}
export function parseCsv(text){
 text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0],separator=first.includes(';')?';':first.includes('\t')?'\t':',';
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&c===separator){row.push(cell);cell='';}else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('В файле не закрыты кавычки.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
export function validateImport(rows){
 const header=rows[0]?.map(v=>String(v??'').trim().toLowerCase());
 if(header?.[0]!=='артикул продавца'||header?.[1]!=='себестоимость'||header.slice(2).some(Boolean))throw Error('Нужны ровно два столбца: Артикул продавца и Себестоимость. Скачайте образец.');
 const seen=new Set(),items=[],errors=[];
 if(rows.length>10001)throw Error('За один раз можно загрузить до 10 000 строк.');
 rows.slice(1).forEach((row,i)=>{
  if(row.every(v=>String(v??'').trim()===''))return;
  const sku=String(row[0]??'').trim(),cost=number(row[1]);let error='';
  if(!sku||sku.length>160)error='Укажите артикул до 160 символов.';
  else if(seen.has(sku))error='Артикул повторяется в файле.';
  else if(!Number.isFinite(cost)||cost<0||cost>1e9)error='Себестоимость должна быть числом от 0 до 1 000 000 000.';
  else if(row.slice(2).some(v=>String(v??'').trim()))error='Лишние значения после второго столбца.';
  seen.add(sku);if(error)errors.push({row:i+2,sku,error});else items.push({sku,cost:round(cost)});
 });
 if(!items.length&&!errors.length)throw Error('В файле нет товаров.');return {items,errors};
}
export function effectiveCost(records,sku,scope){return records.find(r=>r.sku===sku&&r.scope===scope)||records.find(r=>r.sku===sku&&r.scope==='all')||null;}
export function mergeCosts(records,items,scope,source='Загрузка файла'){
 if(!scopes.includes(scope))throw Error('Выберите площадку.');const at=new Date().toISOString(),map=new Map(records.map(r=>[r.scope+'\0'+r.sku,r]));
 for(const item of items){if(!item.sku||!Number.isFinite(item.cost)||item.cost<0)throw Error('Некорректная себестоимость.');map.set(scope+'\0'+item.sku,{...item,scope,source,at});}return [...map.values()];
}
// Распределяем копейки методом наибольших остатков: итог доставки точен.
export function allocateDelivery(total,weights){
 if(!Number.isFinite(total)||total<0||weights.some(v=>!Number.isFinite(v)||v<0))throw Error('Проверьте доставку и базу распределения.');
 const cents=Math.round(total*100),sum=weights.reduce((a,b)=>a+b,0);if(!sum){if(cents)throw Error('Для распределения нужны количество или стоимость товаров.');return weights.map(()=>0);}
 const parts=weights.map((w,i)=>{const raw=cents*w/sum;return {i,cents:Math.floor(raw),fraction:raw-Math.floor(raw)};});let rest=cents-parts.reduce((a,p)=>a+p.cents,0);
 for(const p of [...parts].sort((a,b)=>b.fraction-a.fraction||a.i-b.i)){if(rest--<=0)break;p.cents++;}return parts.map(p=>p.cents/100);
}
export function calculateBatch(rows,columns,delivery,mode){
 if(!['quantity','value'].includes(mode))throw Error('Выберите способ распределения.');
 const data=rows.map(r=>{const qty=number(r.qty),values=columns.map(c=>number(r.values[c.id]??0));if(!r.sku.trim()||!Number.isInteger(qty)||qty<=0||values.some(v=>!Number.isFinite(v)||v<0))throw Error('Заполните артикулы, целое количество больше нуля и неотрицательные расходы.');return {row:r,qty,base:values.reduce((a,b)=>a+b,0)};});
 if(new Set(data.map(r=>r.row.sku.trim())).size!==data.length)throw Error('Артикулы в расчёте не должны повторяться.');
 const shares=allocateDelivery(delivery,data.map(r=>mode==='quantity'?r.qty:r.base*r.qty));
 return data.map((r,i)=>({sku:r.row.sku.trim(),base:round(r.base),qty:r.qty,delivery:shares[i],unitCost:round(r.base+shares[i]/r.qty),batchCost:round(r.base*r.qty+shares[i])}));
}
export function calculateAllocatedBatch(rows,columns,pools){
 const active=rows.filter(r=>r.sku.trim()||String(r.color||'').trim()||String(r.size||'').trim()||String(r.values.purchase??'').trim()!=='');
 const data=active.map(row=>{const qty=number(row.qty),purchase=number(row.values.purchase);if(!row.sku.trim()||!Number.isInteger(qty)||qty<=0||!Number.isFinite(purchase)||purchase<0)throw Error('Заполните артикулы, целое количество больше нуля и стоимость закупки.');return {row,qty,purchase};});
 if(new Set(data.map(r=>r.row.sku.trim())).size!==data.length)throw Error('Артикулы в расчёте не должны повторяться.');
 const allocations={};
 for(const col of columns.filter(c=>c.id!=='purchase')){
  const pool=pools[col.id]||{total:0,mode:'quantity'},total=number(pool.total);
  if(!['quantity','value'].includes(pool.mode)||!Number.isFinite(total)||total<0)throw Error(`Проверьте общую стоимость и распределение: ${col.label}.`);
  if(!data.length){if(total)throw Error('Добавьте товары для распределения общих расходов.');allocations[col.id]=[];continue;}
  const weights=data.map(r=>pool.mode==='value'?r.purchase*r.qty:r.qty);
  if(total>0&&!weights.some(v=>v>0))throw Error(`Для распределения «${col.label}» по стоимости укажите стоимость закупки товаров.`);
  allocations[col.id]=allocateDelivery(total,weights);
 }
 return data.map((r,i)=>{const shares={},unitShares={};for(const col of columns.filter(c=>c.id!=='purchase')){shares[col.id]=allocations[col.id][i];unitShares[col.id]=round(shares[col.id]/r.qty);}const expenses=round(Object.values(shares).reduce((a,b)=>a+b,0));return {id:r.row.id,sku:r.row.sku.trim(),qty:r.qty,purchase:r.purchase,shares,unitShares,expenses,unitCost:round(r.purchase+expenses/r.qty),batchCost:round(r.purchase*r.qty+expenses)};});
}
export function scenario(cost,markup,payouts,revenue){
 if(![cost,markup,payouts,revenue].every(Number.isFinite)||cost<0||markup<0||revenue<=0||payouts<=0||payouts>revenue)return null;
 const ratio=payouts/revenue,price=Math.max(0,Math.ceil(cost*(1+markup/100)/ratio*100-1e-8)/100);
 return {price,profit:round(price*ratio-cost),payout:round(price*ratio),ratio,breakeven:Math.max(0,Math.ceil(cost/ratio*100-1e-8)/100)};
}
export function validApproval(record,cost,finance){return !!record&&record.cost===cost&&record.payouts===finance.payouts&&record.revenue===finance.revenue&&record.period===finance.period;}
export function demoCostState(){return {version:2,records:[],customColumns:[],rows:[],costPools:Object.fromEntries(COMPONENTS.filter(c=>c.id!=='purchase').map(c=>[c.id,{total:0,mode:'quantity'}])),scope:'all',finance:{wb:{payouts:null,revenue:null,period:'',source:'API'},ozon:{payouts:null,revenue:null,period:'',source:'API'}},approvals:[]};}
export function loadCostState(raw){
 const fallback=demoCostState();if(!raw)return fallback;
 try{const s=JSON.parse(raw);if(![1,2].includes(s.version)||!Array.isArray(s.records)||!Array.isArray(s.rows)||!Array.isArray(s.customColumns)||!Array.isArray(s.approvals))return fallback;
  if(s.records.length>50000||s.rows.length>1000||s.customColumns.length>15||!s.rows.every(r=>typeof r.sku==='string'&&r.values&&typeof r.id==='string')||!s.records.every(r=>scopes.includes(r.scope)&&typeof r.sku==='string'&&Number.isFinite(r.cost)&&r.cost>=0)||!s.customColumns.every(c=>/^extra\d+$/.test(c.id)&&typeof c.label==='string'))return fallback;
  if(s.version===1){
   s.costPools={};for(const c of [...AVITO_COMPONENTS,...s.customColumns].filter(c=>c.id!=='purchase'))s.costPools[c.id]={total:round(s.rows.reduce((n,r)=>n+(number(r.values[c.id])||0)*(number(r.qty)||0),0)),mode:'quantity'};
   s.costPools.delivery.total=round(s.costPools.delivery.total+(number(s.delivery)||0));
   s.costPools.delivery.mode=s.distribution==='value'?'value':'quantity';s.needsAllocationReview=true;
  }
  if(!s.costPools||typeof s.costPools!=='object')return fallback;
  return {...fallback,...s,version:2,scope:scopes.includes(s.scope)?s.scope:'all',finance:Object.fromEntries(scopes.filter(k=>k!=='all').map(k=>[k,{...fallback.finance[k],...s.finance?.[k]}]))};
 }catch{return fallback;}
}
