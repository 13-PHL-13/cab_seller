import { useEffect, useState } from "react";
import { Link } from "wouter";
import { RefreshCw, DollarSign, ShoppingCart, Package, BarChart3 } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatMoney, formatNumber } from "@/lib/format";
import { getMarketplaceDashboard, formatApiError } from "@/lib/marketplace-api";
import type { MarketplaceDashboard, MarketplacePeriod } from "@/lib/marketplace-api";

const PERIODS: Array<{ key: MarketplacePeriod; label: string }> = [
  { key: "7d", label: "Неделя" },
  { key: "30d", label: "Месяц" },
  { key: "90d", label: "Квартал" },
];

const shortMoney = (value: number) =>
  Math.abs(value) >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));

export default function DashboardPage() {
  const [period, setPeriod] = useState<MarketplacePeriod>("30d");
  const [data, setData] = useState<MarketplaceDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMarketplaceDashboard(period, "all")
      .then((result) => { if (active) { setData(result); setError(""); } })
      .catch((reason) => { if (active) { setData(null); setError(formatApiError(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, refreshKey]);

  const kpis = [
    { label: "Выручка", value: formatMoney(data?.revenue ?? 0), icon: <DollarSign size={17} /> },
    { label: "Заказы", value: formatNumber(data?.orders ?? 0), icon: <ShoppingCart size={17} /> },
    { label: "Проданные единицы", value: formatNumber(data?.units ?? 0), icon: <Package size={17} /> },
    { label: "Средний чек", value: formatMoney(data?.averageOrderValue ?? 0), icon: <BarChart3 size={17} /> },
  ];

  return (
    <>
      <div className="page-header">
        <div><h1>Дашборд</h1><div className="subtitle">Фактические данные подключённых маркетплейсов</div></div>
        <div className="header-actions">
          <div className="segmented">
            {PERIODS.map((item) => <button key={item.key} className={period === item.key ? "active" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><RefreshCw size={14} /> Обновить</button>
        </div>
      </div>

      {error ? <div className="info-banner" role="alert">{error} <Link href="/settings" className="link">Открыть настройки API</Link></div> : null}
      {data?.partialErrors.map((item) => <div className="info-banner" role="status" key={item}>{item}</div>)}

      <div className="kpi-grid">
        {kpis.map((item) => <div className="kpi-card" key={item.label}><div><div className="kpi-label">{item.label}</div><div className="kpi-value">{loading ? "…" : item.value}</div></div><div className="kpi-icon">{item.icon}</div></div>)}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div><h2 className="card-title">Динамика выручки</h2><div className="card-sub">Дневные значения из API маркетплейсов, ₽</div></div></div>
        {data?.salesSeries.length ? <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data.salesSeries} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs><linearGradient id="revenue-total" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f7df6" stopOpacity={0.22} /><stop offset="100%" stopColor="#2f7df6" stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="4 6" stroke="#edf0f3" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis tickFormatter={shortMoney} tickLine={false} axisLine={false} width={48} />
            <Tooltip formatter={(value) => formatMoney(Number(value))} />
            <Area type="monotone" dataKey="ozonRevenue" name="Ozon" stroke="#005BFF" strokeWidth={2} fill="url(#revenue-total)" dot={false} />
            <Area type="monotone" dataKey="wildberriesRevenue" name="Wildberries" stroke="#A73AFD" strokeWidth={2} fillOpacity={0} dot={false} />
          </AreaChart>
        </ResponsiveContainer> : <div className="empty-state">{loading ? "Загружаем данные…" : "Нет данных за выбранный период. Подключите маркетплейс в настройках."}</div>}
      </div>

      <div className="card">
        <div className="card-head"><div><h2 className="card-title">Воронка продаж</h2><div className="card-sub">Агрегированные показатели из API; временной ряд по стадиям пока не предоставляется</div></div><Link href="/funnel" className="link">Подробнее →</Link></div>
        {data?.funnels.length ? <div className="grid-2-even">
          {data.funnels.map((funnel) => <div className="card" key={funnel.marketplace}>
            <h3>{funnel.marketplace === "ozon" ? "Ozon" : "Wildberries"}</h3>
            <div className="mp-stats">
              <div className="mp-stat"><div className="l">Просмотры</div><div className="v">{formatNumber(funnel.views)}</div></div>
              <div className="mp-stat"><div className="l">Корзины</div><div className="v">{formatNumber(funnel.cartAdds)}</div><div className="l">{funnel.viewToCartPercent.toFixed(1)}%</div></div>
              <div className="mp-stat"><div className="l">Заказы</div><div className="v">{formatNumber(funnel.orders)}</div><div className="l">{funnel.cartToOrderPercent.toFixed(1)}%</div></div>
              <div className="mp-stat"><div className="l">Выкуплено, шт.</div><div className="v">{formatNumber(funnel.purchases)}</div><div className="l">{funnel.orderToPurchasePercent.toFixed(1)}%</div></div>
            </div>
          </div>)}
        </div> : <div className="empty-state">Нет данных воронки. Подключите Wildberries или проверьте доступность метрик.</div>}
      </div>
    </>
  );
}
