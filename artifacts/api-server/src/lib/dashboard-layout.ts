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
      views: snapshot.funnel.views as number | null,
      carts: snapshot.funnel.cartAdds as number | null,
      orders: ozon ? snapshot.funnel.orders : null,
      bought: ozon ? null : snapshot.funnel.units,
      orderAmount: ozon
        ? [...snapshot.daily.values()].reduce((n, p) => n + p.revenue, 0)
        : null,
      boughtAmount: ozon
        ? null
        : [...snapshot.daily.values()].reduce((n, p) => n + p.revenue, 0),
    },
    daily: [...snapshot.daily.values()].map((p) => ({
      date: p.date,
      views: ozon ? p.views : null,
      carts: ozon ? p.cartAdds : null,
      orders: ozon ? p.orders : null,
      bought: ozon ? null : p.units,
      orderAmount: ozon ? p.revenue : null,
      boughtAmount: ozon ? null : p.revenue,
    })),
  };
}
