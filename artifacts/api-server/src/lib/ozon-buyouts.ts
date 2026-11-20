import { providerFetch, SyncRejected } from './sync-context.ts';

export type OzonBuyouts = { daily: Map<string,{ units: number; amount: number | null }> };
function record(value:unknown):Record<string,unknown>{return value && typeof value==='object' ? value as Record<string,unknown> : {};}
function numeric(value:unknown):number|null {
  return typeof value==='number' && Number.isFinite(value) ? value : typeof value==='string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
}

// Financial realizations are distinct from ordered_units and delivered postings.
// Count the report's sale side; returns remain a separate financial operation.
export function realizationDay(rows:unknown[]):{units:number;amount:number|null} {
  let units=0,amount=0,missingAmount=false;
  for(const raw of rows){
    const row=record(raw),sale=record(row.delivery_commission);
    if(!Object.keys(sale).length)continue;
    const quantity=numeric(sale.quantity);
    if(quantity===null || !Number.isInteger(quantity))throw new Error('Ozon: в отчёте реализации отсутствует количество продаж.');
    units+=quantity;
    if(quantity!==0){
      const value=numeric(sale.amount);
      if(value===null)missingAmount=true;else amount+=value;
    }
  }
  return {units,amount:missingAmount?null:Math.round(amount*100)/100};
}

export async function getOzonBuyouts(credentials:{clientId:string;apiKey:string},from:string,to:string):Promise<OzonBuyouts>{
  const daily:OzonBuyouts['daily']=new Map();
  for(let stamp=Date.parse(to);stamp>=Date.parse(from);stamp-=86400000){
    const date=new Date(stamp),key=date.toISOString().slice(0,10);
    const response=await providerFetch('https://api-seller.ozon.ru/v1/finance/realization/by-day',{
      method:'POST',headers:{'Content-Type':'application/json','Client-Id':credentials.clientId,'Api-Key':credentials.apiKey},
      body:JSON.stringify({day:date.getUTCDate(),month:date.getUTCMonth()+1,year:date.getUTCFullYear()}),
      signal:AbortSignal.timeout(30_000),
    });
    if(response.status===401 || response.status===403)throw new SyncRejected(response.status);
    if(!response.ok)throw new Error(`Ozon: отчёт реализации вернул HTTP ${response.status}.`);
    const body=record(await response.json());
    if(!Array.isArray(body.rows))throw new Error('Ozon: не получены строки ежедневного отчёта реализации.');
    daily.set(key,realizationDay(body.rows));
  }
  return {daily};
}
