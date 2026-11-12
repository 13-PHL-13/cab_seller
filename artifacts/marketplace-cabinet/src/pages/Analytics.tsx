import { useEffect, useState } from "react";
import { formatMoney, formatNumber } from "@/lib/format";
import { getMarketplaceDashboard, formatApiError } from "@/lib/marketplace-api";
import type { MarketplaceDashboard, MarketplacePeriod } from "@/lib/marketplace-api";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const periods: Array<{ key: MarketplacePeriod; label: string }> = [{ key: "7d", label: "Неделя" }, { key: "30d", label: "Месяц" }, { key: "90d", label: "Квартал" }];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<MarketplacePeriod>("30d");
  const [data, setData] = useState<MarketplaceDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMarketplaceDashboard(period, "all").then((value) => { if (active) { setData(value); setError(""); } })
      .catch((reason) => { if (active) { setData(null); setError(formatApiError(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period]);

  return <>
    <div className="page-header"><div><h1>Аналитика</h1><div className="subtitle">Продажи и воронка по данным подключённых API</div></div>
      <div className="segmented">{periods.map((item) => <button key={item.key} className={period === item.key ? "active" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>
    </div>
    {error ? <div className="info-banner" role="alert">{error}</div> : null}
    <div className="kpi-grid">
      {[["Выручка", formatMoney(data?.revenue ?? 0)], ["Заказы", formatNumber(data?.orders ?? 0)], ["Проданные единицы", formatNumber(data?.units ?? 0)], ["Средний чек", formatMoney(data?.averageOrderValue ?? 0)]].map(([label, value]) => <div className="kpi-card" key={label}><div><div className="kpi-label">{label}</div><div className="kpi-value">{loading ? "…" : value}</div></div></div>)}
    </div>
    <div className="card"><div className="card-head"><div><h2 className="card-title">Выручка по дням</h2><div className="card-sub">Фактические значения, полученные от маркетплейсов</div></div></div>
      {data?.salesSeries.length ? <ResponsiveContainer width="100%" height={320}><AreaChart data={data.salesSeries}><CartesianGrid strokeDasharray="4 6" stroke="#edf0f3" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickFormatter={(v) => `${Math.round(Number(v)/1000)}k`} tickLine={false} axisLine={false}/><Tooltip formatter={(v) => formatMoney(Number(v))}/><Area dataKey="ozonRevenue" name="Ozon" stroke="#005BFF" fill="#005BFF" fillOpacity={0.12}/><Area dataKey="wildberriesRevenue" name="Wildberries" stroke="#A73AFD" fill="#A73AFD" fillOpacity={0.12}/></AreaChart></ResponsiveContainer> : <div className="empty-state">{loading ? "Загружаем…" : "Нет данных за выбранный период."}</div>}
    </div>
    <div className="info-banner">Детализация по SKU, категориям, остаткам и товарам пока не предоставляется серверным API кабинета и поэтому скрыта, а не заменяется демонстрационными значениями.</div>
  </>;
}
