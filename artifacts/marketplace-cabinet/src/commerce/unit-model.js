// Preserved from the approved Dashboard-node-v1 prototype.
// Денежные входы — рубли; суммы складываются в копейках. API-адаптер передаёт
// операции со стабильными id и датами. Демо-генератор не является API площадки.
import {allocateDelivery} from './costs-model.js';
export const UNIT_KEY='navigator-unit-economics-v1';
export const moneyRound=n=>Math.round((n+Number.EPSILON)*100)/100;
export const normalizeSku=s=>String(s??'').normalize('NFC').trim();
export const listingKey=l=>JSON.stringify([l.storeId,l.id]);
export const groupKey=(l,links={})=>links[listingKey(l)]||'sku:'+normalizeSku(l.sku);
const sum=(rows,k)=>rows.reduce((n,r)=>n+Math.round((r[k]||0)*100),0)/100;
const fields=['orders','bought','cancellations','returns','revenue','commission','logistics','ads','other','tax','extra','cost'];
export function summarize(rows,unavailable=false){
 if(rows.some(r=>r.unknown)||(!rows.length&&unavailable))return {...Object.fromEntries([...fields,'expenses','payout','margin','profit','unitProfit','unitCost','profitRate','markup','drr','buyoutRate'].map(k=>[k,null])),missingCost:rows.reduce((n,r)=>n+(r.missingCost||0),0),missingTax:0};
 const r=Object.fromEntries(fields.map(k=>[k,sum(rows,k)]));
 r.missingCost=rows.reduce((n,x)=>n+(x.missingCost||0),0);r.missingTax=rows.reduce((n,x)=>n+(x.missingTax||0),0);
 r.expenses=moneyRound(r.commission+r.logistics+r.ads+r.other+r.tax+r.extra);
 r.payout=moneyRound(r.revenue-r.commission-r.logistics-r.other);
 r.margin=r.missingCost?null:moneyRound(r.revenue-r.cost-r.commission-r.logistics-r.ads-r.other);
 r.profit=r.margin===null||r.missingTax?null:moneyRound(r.margin-r.tax-r.extra);
 r.unitProfit=r.bought&&r.profit!==null?moneyRound(r.profit/r.bought):null;
 r.unitCost=r.bought&&!r.missingCost?moneyRound(r.cost/r.bought):null;
 r.profitRate=r.revenue&&r.profit!==null?r.profit/r.revenue*100:null;
 r.markup=r.cost&&r.profit!==null?r.profit/r.cost*100:null;
 r.drr=r.revenue?r.ads/r.revenue*100:null;
 const finished=r.bought+r.cancellations+r.returns;r.buyoutRate=finished?r.bought/finished*100:null;
 return r;
}
export function dateRange(from,to){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw Error('Выберите начало и конец периода.');
 const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
 if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start).toISOString().slice(0,10)!==from||new Date(end).toISOString().slice(0,10)!==to||start>end)throw Error('Начало периода должно быть не позже конца.');
 if((end-start)/86400000>365)throw Error('Выберите период не длиннее года.');
 return Array.from({length:(end-start)/86400000+1},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
}
export function unitRows({listings,operations,stores,links={},costFor,settings={},from,to,basis='sales',storeIds,platform='all',source='demo'}){
 dateRange(from,to);
 const allowed=new Map(stores.filter(s=>(platform==='all'||s.platform===platform)&&(!storeIds||storeIds.includes(s.id))).map(s=>[s.id,s]));
 const ls=new Map(listings.filter(l=>allowed.has(l.storeId)).map(l=>[listingKey(l),l]));
 // Дополнительные расходы распределяются по выручке полного месяца магазина,
 // до фильтра по товару/дню. Поэтому поиск не меняет прибыль единицы.
 const monthOps=new Map(),allocatedExtra=new Map();
 for(const o of operations){if(!allowed.has(o.storeId))continue;const date=basis==='orders'?o.orderDate:(o.saleDate||o.orderDate);const k=JSON.stringify([o.storeId,date.slice(0,7)]);if(!monthOps.has(k))monthOps.set(k,[]);monthOps.get(k).push(o);}
 for(const [key,ops] of monthOps){const [id,month]=JSON.parse(key),total=Number(settings[id]?.monthly?.[month]||0),weights=ops.map(o=>Math.max(0,o.revenue));if(!weights.some(Boolean))continue;const allocations=allocateDelivery(total,weights);ops.forEach((o,i)=>allocatedExtra.set(o.id,allocations[i]));}
 const all=[];
 for(const o of operations){const l=ls.get(listingKey({storeId:o.storeId,id:o.listingId}));if(!l)continue;
  const date=basis==='orders'?o.orderDate:(o.saleDate||o.orderDate);
  const s=allowed.get(l.storeId),cost=costFor(l,s.platform,o.orderDate),config=settings[s.id]||{};
  if(basis==='sales'&&o.orderDate>=from&&o.orderDate<=to)all.push({...Object.fromEntries(fields.map(k=>[k,0])),id:o.id+':order',date:o.orderDate,storeId:o.storeId,listing:l,store:s,groupId:groupKey(l,links),orders:o.orders,missingCost:0,missingTax:0});
  if(date<from||date>to)continue;
  const taxRate=config.taxRate??(source==='demo'?6:null);
  all.push({...o,orders:basis==='sales'?0:o.orders,date,listing:l,store:s,groupId:groupKey(l,links),cost:cost===null?0:moneyRound(cost*o.bought),missingCost:cost===null?o.bought:0,missingTax:taxRate===null&&o.revenue?1:0,tax:moneyRound(o.revenue*Number(taxRate)/100),extra:allocatedExtra.get(o.id)||0});
 }
 if(source==='api')for(const l of ls.values())if(!all.some(o=>o.storeId===l.storeId&&o.listing.id===l.id)){const s=allowed.get(l.storeId);all.push({...Object.fromEntries(fields.map(k=>[k,null])),id:'missing:'+listingKey(l),date:from,listing:l,store:s,storeId:l.storeId,groupId:groupKey(l,links),unknown:true,missingCost:0});}
 // Даже товары без операций в периоде остаются в таблице.
 const groups=new Map();
 for(const l of ls.values()){const id=groupKey(l,links);if(!groups.has(id))groups.set(id,{id,sku:id.startsWith('sku:')?id.slice(4):l.sku,name:l.name,listings:[],rows:[]});groups.get(id).listings.push(l);}
 for(const o of all)groups.get(o.groupId)?.rows.push(o);
 return [...groups.values()].map(g=>({...g,total:summarize(g.rows),markets:[...new Set(g.listings.map(l=>allowed.get(l.storeId).platform))].map(platform=>{
  const members=g.listings.filter(l=>allowed.get(l.storeId).platform===platform),rows=g.rows.filter(o=>o.store.platform===platform);
  return {platform,total:summarize(rows),stores:[...new Set(members.map(l=>l.storeId))].map(id=>({store:allowed.get(id),listings:members.filter(l=>l.storeId===id),rows:rows.filter(o=>o.storeId===id),total:summarize(rows.filter(o=>o.storeId===id))}))};})}));
}
export function setMatch(links,listing,target){
 if(typeof target!=='string'||!target||target.length>500)throw Error('Выберите товар для объединения.');
 return {...links,[listingKey(listing)]:target};
}
export function detachMatch(links,listing){return setMatch(links,listing,'listing:'+listingKey(listing));}
export function exportRows(groups,{unit=false}={}){
 const header=['Уровень','Артикул продавца','Товар','Площадка','Магазин','Заказы, шт.','Выкупы, шт.','Выручка, ₽','Себестоимость, ₽','Расходы, ₽','Прибыль, ₽','Прибыль / шт., ₽','Рентабельность, %'];
 const row=(level,g,t,market='',store='')=>{const d=unit?(t.bought||null):1,n=v=>v===null||d===null?null:moneyRound(v/d);return [level,g.sku,g.name,market,store,t.orders,t.bought,n(t.revenue),t.missingCost?null:n(t.cost),n(t.expenses),n(t.profit),t.unitProfit,t.profitRate===null?null:moneyRound(t.profitRate)];};
 return [header,...groups.flatMap(g=>[row('Товар',g,g.total),...g.markets.flatMap(m=>[row('Площадка',g,m.total,m.platform),...m.stores.map(s=>row('Магазин',g,s.total,m.platform,s.store.name))])])];
}
