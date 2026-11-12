import { useEffect, useState } from "react";
import { getMarketplaceDashboard, formatApiError } from "@/lib/marketplace-api";
import type { MarketplaceDashboard, MarketplaceFilter, MarketplacePeriod } from "@/lib/marketplace-api";
import { formatNumber } from "@/lib/format";

const periods: Array<{ key: MarketplacePeriod; label: string }> = [{ key: "7d", label: "Неделя" }, { key: "30d", label: "Месяц" }, { key: "90d", label: "Квартал" }];

export default function FunnelPage() {
  const [period, setPeriod] = useState<MarketplacePeriod>("30d");
  const [platform, setPlatform] = useState<MarketplaceFilter>("all");
  const [data, setData] = useState<MarketplaceDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    getMarketplaceDashboard(period, platform).then((value) => { if (active) { setData(value); setError(""); } })
      .catch((reason) => { if (active) { setData(null); setError(formatApiError(reason)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, platform]);
  const rows = data?.funnels ?? [];
  return <>
    <div className="page-header"><div><h1>Воронка продаж</h1><div className="subtitle">Фактические агрегированные метрики площадок</div></div>
      <div className="header-actions"><select className="select" value={platform} onChange={(event) => setPlatform(event.target.value as MarketplaceFilter)}><option value="all">Все площадки</option><option value="ozon">Ozon</option><option value="wildberries">Wildberries</option></select><div className="segmented">{periods.map((item) => <button key={item.key} className={period === item.key ? "active" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div></div>
    </div>
    {error ? <div className="info-banner" role="alert">{error}</div> : null}
    {rows.length ? <div className="grid-2-even">{rows.map((row) => <div className="card" key={row.marketplace}><h2 className="card-title">{row.marketplace === "ozon" ? "Ozon" : "Wildberries"}</h2>
      {[["Просмотры", row.views], ["Добавления в корзину", row.cartAdds], ["Заказы", row.orders], ["Выкуплено, шт.", row.purchases]].map(([label, value]) => <div className="notif-row" key={label as string}><span>{label}</span><strong>{loading ? "…" : formatNumber(Number(value))}</strong></div>)}
      <div className="mp-stats"><div className="mp-stat"><div className="l">Просмотр → корзина</div><div className="v">{row.viewToCartPercent.toFixed(1)}%</div></div><div className="mp-stat"><div className="l">Корзина → заказ</div><div className="v">{row.cartToOrderPercent.toFixed(1)}%</div></div><div className="mp-stat"><div className="l">Заказ → выкуп</div><div className="v">{row.orderToPurchasePercent.toFixed(1)}%</div></div></div>
    </div>)}</div> : <div className="empty-state">{loading ? "Загружаем данные…" : "Нет доступных данных воронки для выбранных площадок."}</div>}
    <div className="info-banner">Сервер пока возвращает агрегаты за период, но не дневную историю стадий. График по дням отключён, чтобы не показывать вымышленные значения.</div>
  </>;
}
