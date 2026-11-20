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
  return {
    totals: {
      views: snapshot.unavailable?.funnel || snapshot.unavailable?.views ? null : snapshot.funnel.views as number | null,
      carts: snapshot.unavailable?.funnel || snapshot.unavailable?.carts ? null : snapshot.funnel.cartAdds as number | null,
      orders: ozon && !snapshot.unavailable?.orders ? snapshot.funnel.orders : null,
      bought: ozon || snapshot.unavailable?.sales ? null : [...snapshot.daily.values()].reduce((n,p)=>n+p.units,0),
      orderAmount: ozon && !snapshot.unavailable?.revenue
        ? [...snapshot.daily.values()].reduce((n, p) => n + p.revenue, 0)
        : null,
      boughtAmount: ozon || snapshot.unavailable?.sales
        ? null
        : [...snapshot.daily.values()].reduce((n, p) => n + p.revenue, 0),
    },
    daily: [...snapshot.daily.values()].map((p) => ({
      date: p.date,
      views: ozon && !snapshot.unavailable?.views ? p.views : null,
      carts: ozon && !snapshot.unavailable?.carts ? p.cartAdds : null,
      orders: ozon && !snapshot.unavailable?.orders ? p.orders : null,
      bought: ozon ? null : p.units,
      orderAmount: ozon && !snapshot.unavailable?.revenue ? p.revenue : null,
      boughtAmount: ozon ? null : p.revenue,
    })),
  };
}
