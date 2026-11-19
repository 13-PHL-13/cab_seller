// Preserved from the approved Dashboard-node-v1 prototype.
import {number,calculateAllocatedBatch,COMPONENTS,AVITO_COMPONENTS} from './costs-model.js';
export const MANUAL_HEADERS=['Артикул поставщика','Стоимость за единицу','Закупленное количество'];
export function validateManualImport(rows){
 const header=rows[0]?.map(v=>String(v??'').trim().toLowerCase());
 if(!header||MANUAL_HEADERS.some((h,i)=>header[i]!==h.toLowerCase())||header.slice(3).some(Boolean))throw Error('Нужны три столбца: Артикул поставщика, Стоимость за единицу, Закупленное количество. Скачайте шаблон.');
 if(rows.length>1001)throw Error('В ручной таблице допускается до 1000 строк.');
 const items=[],errors=[],seen=new Set();
 rows.slice(1).forEach((cells,i)=>{
  if(!cells.some(v=>String(v??'').trim()))return;
  const sku=String(cells[0]??'').trim(),qty=number(cells[2]),purchase=number(cells[1]);let error='';
  if(!sku||sku.length>160)error='Введите артикул до 160 символов.';
  else if(seen.has(sku))error='Артикул повторяется.';
  else if(!Number.isInteger(qty)||qty<=0)error='Количество должно быть целым числом больше нуля.';
  else if(!Number.isFinite(purchase)||purchase<0)error='Стоимость должна быть числом не меньше нуля.';
  else if(cells.slice(3).some(v=>String(v??'').trim()))error='В строке есть лишние столбцы.';
  seen.add(sku);if(error)errors.push({row:i+2,sku,error});else items.push({sku,color:'',size:'',qty,values:{purchase}});
 });
 if(!items.length&&!errors.length)errors.push({row:2,error:'В файле нет товаров.'});
 return {items,errors};
}
export function priceCosts(state,scope,market){
 const records=[...state.records];
 if(scope!=='all'&&scope!==market)return {records,error:null};
 try{
  const cols=[...(scope==='avito'?AVITO_COMPONENTS:COMPONENTS),...state.customColumns];
  const rows=calculateAllocatedBatch(state.rows,cols,state.costPools);
  for(const row of rows){const index=records.findIndex(r=>r.scope===scope&&r.sku===row.sku),record={sku:row.sku,scope,cost:row.unitCost,source:'Текущий ручной расчёт'};if(index<0)records.push(record);else records[index]=record;}
  return {records,error:null};
 }catch(error){return {records:[],error:error.message};}
}
