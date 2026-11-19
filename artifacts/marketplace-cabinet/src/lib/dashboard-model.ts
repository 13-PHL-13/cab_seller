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
    totals: Record<DashboardMetric, number | null>;
    daily: DashboardPoint[];
  };
}
export interface DashboardWindow {
  from: string;
  to: string;
  stores: DashboardStore[];
  partialErrors: string[];
}
export interface BlockContext {
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
