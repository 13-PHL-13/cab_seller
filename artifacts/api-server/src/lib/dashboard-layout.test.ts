import test from "node:test";
import assert from "node:assert/strict";
import { dashboardWindow, dashboardStoreData } from "./dashboard-layout.ts";
test("14-day windows are contiguous and use the company local calendar", () => {
  const now = new Date("2026-11-19T21:00:00Z");
  assert.deepEqual(dashboardWindow("current", now), {
    from: "2026-11-07",
    to: "2026-11-20",
  });
  assert.deepEqual(dashboardWindow("previous", now), {
    from: "2026-10-24",
    to: "2026-11-06",
  });
});
test("unsupported metrics remain missing, never become zero or a different metric", () => {
  const snapshot = {
    daily: new Map([
      [
        "2026-11-20",
        {
          date: "2026-11-20",
          orders: 9,
          units: 5,
          revenue: 100,
          views: 20,
          cartAdds: 10,
        },
      ],
    ]),
    funnel: { orders: 9, units: 5, views: 20, cartAdds: 10 },
  };
  const ozon = dashboardStoreData(snapshot, "ozon");
  assert.equal(ozon.totals.bought, null);
  assert.equal(ozon.totals.orders, 9);
  assert.equal(ozon.daily[0].boughtAmount, null);
  const wb = dashboardStoreData(snapshot, "wildberries");
  assert.equal(wb.totals.orders, 9);
  assert.equal(wb.daily[0].views, null);
  assert.equal(wb.totals.bought, 5);
});
