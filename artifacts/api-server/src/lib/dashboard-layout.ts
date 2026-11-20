import type { MarketplaceSnapshot } from "./marketplace-data";
export function dashboardWindow(
  view: "current" | "previous",
  now = new Date(),
) {
  const today = new Date(now.getTime() + 5 * 3600000)
    .toISOString()
    .slice(0, 10);
  const shift = (days: number) =>
    new Date(Date.parse(today + "T00:00:00Z") + days * 86400000)
      .toISOString()
      .slice(0, 10);
  return view === "previous"
    ? { from: shift(-27), to: shift(-14) }
    : { from: shift(-13), to: today };
}
export function dashboardStoreData(
  snapshot: MarketplaceSnapshot,
  platform: "ozon" | "wildberries",
) {
  const ozon = platform === "ozon";
  const points=[...snapshot.daily.values()];
  const missing=(point:typeof points[number],key:'views'|'carts'|'orders'|'revenue')=>point.missing?.[key] || (snapshot.metricSchemaVersion!==2 && snapshot.unavailable?.[key]);
  const buyoutTotal=(field:'boughtUnits'|'boughtAmount')=>points.length && points.every(point=>typeof point[field]==='number') ? points.reduce((sum,point)=>sum+point[field]!,0) : null;
  return {
    reasons:{views:snapshot.unavailable?.views??snapshot.unavailable?.funnel,carts:snapshot.unavailable?.carts??snapshot.unavailable?.funnel,orders:snapshot.unavailable?.orders,bought:snapshot.unavailable?.buyouts,boughtAmount:snapshot.unavailable?.buyouts},
    totals: {
      views: snapshot.unavailable?.funnel || snapshot.unavailable?.views ? null : snapshot.funnel.views as number | null,
      carts: snapshot.unavailable?.funnel || snapshot.unavailable?.carts ? null : snapshot.funnel.cartAdds as number | null,
      orders: ozon && !snapshot.unavailable?.orders ? snapshot.funnel.orders : null,
      bought: ozon ? buyoutTotal('boughtUnits') : snapshot.unavailable?.sales ? null : points.reduce((n,p)=>n+p.units,0),
      orderAmount: ozon && !snapshot.unavailable?.revenue
        ? [...snapshot.daily.values()].reduce((n, p) => n + p.revenue, 0)
        : null,
      boughtAmount: ozon ? buyoutTotal('boughtAmount') : snapshot.unavailable?.sales
        ? null
        : [...snapshot.daily.values()].reduce((n, p) => n + p.revenue, 0),
    },
    daily: [...snapshot.daily.values()].map((p) => ({
      date: p.date,
      views: ozon && !missing(p,'views') ? p.views : null,
      carts: ozon && !missing(p,'carts') ? p.cartAdds : null,
      orders: ozon && !missing(p,'orders') ? p.orders : null,
      bought: ozon ? p.boughtUnits??null : p.units,
      orderAmount: ozon && !missing(p,'revenue') ? p.revenue : null,
      boughtAmount: ozon ? p.boughtAmount??null : p.revenue,
    })),
  };
}
