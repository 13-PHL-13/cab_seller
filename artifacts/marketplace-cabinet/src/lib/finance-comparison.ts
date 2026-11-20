import {calendarDays,completeSum} from './dashboard-model.ts';

export function previousFinancePeriod(today:string){
  const current=new Date(today+'T00:00:00Z');
  const last=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth(),0));
  const from=last.toISOString().slice(0,7)+'-01';
  const comparable=current.getUTCDate()<=last.getUTCDate();
  return {from,to:from.slice(0,8)+String(Math.min(current.getUTCDate(),last.getUTCDate())).padStart(2,'0'),sourceTo:last.toISOString().slice(0,10),comparable};
}

type Amounts={revenue:number|null;expenses:number|null;commission:number|null;logistics:number|null;other:number|null};
export function financePeriodAmounts(report:{from:string;to:string;dashboard?:Amounts;dailyDashboard?:Array<{date:string}&Amounts>}|undefined,from:string,to:string):Amounts|undefined{
  if(!report)return undefined;
  if(report.from===from&&report.to===to)return report.dashboard;
  const days=calendarDays(from,to),rows=report.dailyDashboard;
  if(!rows||!days.length||days.some(date=>rows.filter(row=>row.date===date).length!==1))return undefined;
  return Object.fromEntries((['revenue','expenses','commission','logistics','other'] as const).map(key=>[key,completeSum(days.map(date=>rows.find(row=>row.date===date)![key]))])) as Amounts;
}

export function financeComparisonBaseline(stores:Array<{id:number}>,current:Record<number,Partial<Record<string,number|null>>>,previous:Record<number,Partial<Record<string,number|null>>>,key:string){
  const included=(values:typeof current)=>stores.filter(store=>typeof values[store.id]?.[key]==='number'&&Number.isFinite(values[store.id]?.[key]));
  const own=included(current),past=included(previous);
  if(!own.length||own.map(s=>s.id).sort((a,b)=>a-b).join(',')!==past.map(s=>s.id).sort((a,b)=>a-b).join(','))return null;
  return completeSum(past.map(store=>previous[store.id]?.[key]));
}
