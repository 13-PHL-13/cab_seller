export type DashboardMetric =
  "views" | "carts" | "orders" | "bought" | "orderAmount" | "boughtAmount";
export type DashboardPoint = { date: string } & Record<
  DashboardMetric,
  number | null
>;
export interface DashboardStore {
  id: number;
  storeName: string;
  marketplace: "ozon" | "wildberries";
  data: {
    subscription?: {type:string;label:string;isPremium:boolean|null;advancedAnalytics:boolean|null;checkedAt:string|null};
    totals: Record<DashboardMetric, number | null>;
    daily: DashboardPoint[];
    reasons?: Partial<Record<DashboardMetric,string>>;
  };
}
export interface DashboardWindow {
  from: string;
  to: string;
  stores: DashboardStore[];
  partialErrors: string[];
}
export interface BlockContext {
  sectionId?: 'products';
  section: string;
  stores: string;
  period: string;
  storeIds: string[];
  reference?: string;
  image?: { dataUrl: string; width: number; height: number; at: string };
}
export function completeSum(
  values: Array<number | null | undefined>,
): number | null {
  return values.length &&
    values.every((v) => typeof v === "number" && Number.isFinite(v))
    ? values.reduce<number>((n, v) => n + (v ?? 0), 0)
    : null;
}
type StoreIdentity = {id:number;storeName:string;marketplace:string};
/** A missing source is excluded explicitly; an unknown value never becomes zero. */
export function metricCoverage(stores: StoreIdentity[], window: DashboardWindow | undefined, key: DashboardMetric, daily=false) {
  const included=stores.filter(store=>{
    const data=window?.stores.find(s=>s.id===store.id)?.data;
    return daily ? data?.daily.some(p=>typeof p[key]==='number' && Number.isFinite(p[key])) : typeof data?.totals[key]==='number' && Number.isFinite(data.totals[key]);
  });
  return {included,excluded:stores.filter(s=>!included.some(i=>i.id===s.id))};
}
export function metricSum(stores: StoreIdentity[], window: DashboardWindow | undefined, key: DashboardMetric) {
  return completeSum(metricCoverage(stores,window,key).included.map(s=>window?.stores.find(i=>i.id===s.id)?.data.totals[key]));
}
export function sameMetricCohort(stores: StoreIdentity[], current: DashboardWindow | undefined, previous: DashboardWindow | undefined, key: DashboardMetric, daily=false) {
  const ids=(window:DashboardWindow|undefined)=>metricCoverage(stores,window,key,daily).included.map(s=>s.id).sort((a,b)=>a-b).join(',');
  return !!current && !!previous && ids(current)!=='' && ids(current)===ids(previous);
}
export function change(
  value: number | null,
  previous: number | null,
): number | null {
  return value === null || previous === null || previous === 0
    ? null
    : ((value - previous) / Math.abs(previous)) * 100;
}
export function calendarDays(from: string, to: string) {
  const result: string[] = [];
  for (
    let t = Date.parse(from + "T00:00:00Z");
    t <= Date.parse(to + "T00:00:00Z");
    t += 86400000
  )
    result.push(new Date(t).toISOString().slice(0, 10));
  return result;
}
export const money = (n: number | null) =>
  n === null
    ? "Нет данных"
    : n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
export const quantity = (n: number | null) =>
  n === null
    ? "Нет данных"
    : n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
