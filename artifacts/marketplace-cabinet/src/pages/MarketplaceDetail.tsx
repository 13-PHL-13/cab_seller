import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getMarketplaceDashboard, formatApiError } from "@/lib/marketplace-api";
import type { MarketplaceDashboard, MarketplaceId } from "@/lib/marketplace-api";
import { formatMoney, formatNumber } from "@/lib/format";
import { EmptyState } from "@/components/ui-bits";

export default function MarketplaceDetailPage() {
  const [match, params] = useRoute("/marketplace/:id");
  const id = match ? (params?.id ?? "") : "";
  const valid = id === "ozon" || id === "wb";
  const marketplace: MarketplaceId = id === "ozon" ? "ozon" : "wildberries";
  const [data, setData] = useState<MarketplaceDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!valid) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    getMarketplaceDashboard("30d", marketplace).then((value) => { if (active) { setData(value); setError(""); } })
      .catch((reason) => { if (active) { setData(null); setError(formatApiError(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [valid, marketplace]);

  if (!valid) return <EmptyState icon={null} title="Площадка не найдена" text="Доступны только Ozon и Wildberries." action={<Link href="/marketplaces" className="btn btn-primary">К маркетплейсам</Link>} />;

  const funnel = data?.funnels.find((item) => item.marketplace === marketplace);
  const revenue = data?.salesSeries.reduce((sum, day) => sum + (marketplace === "ozon" ? day.ozonRevenue : day.wildberriesRevenue), 0) ?? 0;
  const name = marketplace === "ozon" ? "Ozon" : "Wildberries";

  return <>
    <div className="page-header"><div><h1>{name}</h1><div className="subtitle">Реальные данные API за 30 дней</div></div><div className="header-actions"><Link href="/marketplaces" className="btn btn-outline">Все площадки</Link><Link href="/settings" className="btn btn-outline">Настройки API</Link></div></div>
    {error ? <div className="info-banner" role="alert">{error}</div> : null}
    <div className="kpi-grid">
      {[["Выручка", formatMoney(revenue)], ["Заказы", formatNumber(funnel?.orders ?? 0)], ["Выкуплено, шт.", formatNumber(funnel?.purchases ?? 0)], ["Просмотры", formatNumber(funnel?.views ?? 0)]].map(([label, value]) => <div className="kpi-card" key={label}><div><div className="kpi-label">{label}</div><div className="kpi-value">{loading ? "…" : value}</div></div></div>)}
    </div>
    <div className="card"><div className="card-head"><div><h2 className="card-title">Выручка по дням</h2><div className="card-sub">Источник: API {name}</div></div></div>
      {data?.salesSeries.length ? <ResponsiveContainer width="100%" height={280}><AreaChart data={data.salesSeries}><CartesianGrid strokeDasharray="4 6" stroke="#edf0f3" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickFormatter={(v) => `${Math.round(Number(v)/1000)}k`} tickLine={false} axisLine={false}/><Tooltip formatter={(v) => formatMoney(Number(v))}/><Area dataKey={marketplace === "ozon" ? "ozonRevenue" : "wildberriesRevenue"} name="Выручка" stroke={marketplace === "ozon" ? "#005BFF" : "#A73AFD"} fillOpacity={0.12}/></AreaChart></ResponsiveContainer> : <div className="empty-state">{loading ? "Загружаем…" : "Нет данных за выбранный период."}</div>}
    </div>
    <div className="info-banner">Список товаров, остатки и география пока не поддерживаются API этого кабинета. Демонстрационные данные удалены из этой страницы.</div>
  </>;
}
