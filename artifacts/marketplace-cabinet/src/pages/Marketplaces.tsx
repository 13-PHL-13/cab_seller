import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Plug, RefreshCw } from "lucide-react";
import { formatMoney, formatNumber } from "@/lib/format";
import { getMarketplaceConnections, getMarketplaceDashboard, formatApiError } from "@/lib/marketplace-api";
import type { MarketplaceConnection, MarketplaceDashboard } from "@/lib/marketplace-api";

export default function MarketplacesPage() {
  const [connections, setConnections] = useState<MarketplaceConnection[]>([]);
  const [dashboard, setDashboard] = useState<MarketplaceDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [connectionRows, stats] = await Promise.all([
        getMarketplaceConnections(),
        getMarketplaceDashboard("30d", "all"),
      ]);
      setConnections(connectionRows);
      setDashboard(stats);
    } catch (reason) {
      setError(formatApiError(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <>
      <div className="page-header">
        <div><h1>Маркетплейсы</h1><div className="subtitle">Состояние подключений и реальные показатели за 30 дней</div></div>
        <div className="header-actions">
          <button className="btn btn-outline btn-sm" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} /> Обновить</button>
          <Link href="/settings" className="btn btn-outline"><Plug size={15} /> Настроить API</Link>
        </div>
      </div>
      {error ? <div className="info-banner" role="alert">{error}</div> : null}
      <div className="grid-2-even">
        {(["ozon", "wildberries"] as const).map((id) => {
          const connection = connections.find((item) => item.marketplace === id);
          const funnel = dashboard?.funnels.find((item) => item.marketplace === id);
          const revenue = dashboard?.salesSeries.reduce((sum, day) => sum + (id === "ozon" ? day.ozonRevenue : day.wildberriesRevenue), 0) ?? 0;
          const connected = connection?.connected ?? false;
          return <div className="card mp-card" key={id}>
            <div className="mp-head">
              <div><div style={{ fontWeight: 800, fontSize: 17 }}>{id === "ozon" ? "Ozon" : "Wildberries"}</div>
                <span className={`badge ${connected ? "badge-green" : "badge-gray"}`} style={{ marginTop: 5 }}>{connected ? "Подключён" : "Не подключён"}</span>
              </div>
              {connection?.lastSyncAt ? <span className="badge badge-blue">Обновлено {new Date(connection.lastSyncAt).toLocaleString("ru-RU")}</span> : null}
            </div>
            <div className="mp-stats">
              <div className="mp-stat"><div className="l">Выручка</div><div className="v">{loading ? "…" : formatMoney(revenue)}</div></div>
              <div className="mp-stat"><div className="l">Заказы</div><div className="v">{formatNumber(funnel?.orders ?? 0)}</div></div>
              <div className="mp-stat"><div className="l">Выкуплено, шт.</div><div className="v">{formatNumber(funnel?.purchases ?? 0)}</div></div>
            </div>
            <Link href="/settings" className="btn btn-outline" style={{ alignSelf: "flex-start" }}>{connected ? "Управлять подключением" : "Подключить по API"}</Link>
          </div>;
        })}
      </div>
      <div className="info-banner">В этом разделе отображаются только площадки, для которых реализована серверная интеграция. Яндекс Маркет и Мегамаркет пока не подключены.</div>
    </>
  );
}
