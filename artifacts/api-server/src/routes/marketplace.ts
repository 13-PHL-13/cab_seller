import { getOzonFinanceReport } from "../lib/marketplace-finance-ozon";
import { getWildberriesFinanceReport } from "../lib/marketplace-finance";
import {
  ConnectOzonBody,
  ConnectOzonResponse,
  ConnectWildberriesBody,
  ConnectWildberriesResponse,
  DisconnectMarketplaceParams,
  GetMarketplaceDashboardQueryParams,
  GetMarketplaceDashboardResponse,
  ListMarketplaceConnectionsResponse,
} from "@workspace/api-zod";
import { db, marketplaceConnectionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { requireUser } from "../middlewares/requireUser";
import {
  decryptCredentials,
  encryptCredentials,
} from "../lib/marketplace-credentials";
import {
  getOzonSnapshot,
  getWildberriesSnapshot,
  periodDates,
  verifyOzonCredentials,
  verifyWildberriesCredentials,
  type MarketplaceSnapshot,
} from "../lib/marketplace-data";

type Marketplace = "ozon" | "wildberries";
type ConnectionCredentials =
  | { clientId: string; apiKey: string }
  | { apiKey: string };

const router: IRouter = Router();
router.use("/marketplace", requireUser);

function userIdFromRequest(req: Express.Request): string {
  const userId = req.userId;
  if (!userId) throw new Error("Authenticated user is missing");
  return userId;
}

function connectionView(
  marketplace: Marketplace,
  row?: typeof marketplaceConnectionsTable.$inferSelect,
) {
  return {
    marketplace,
    connected: Boolean(row),
    storeName: row?.storeName ?? null,
    lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    statusMessage: row ? "Подключено" : null,
  };
}

async function findConnection(ownerId: string, marketplace: Marketplace) {
  const [row] = await db
    .select()
    .from(marketplaceConnectionsTable)
    .where(
      and(
        eq(marketplaceConnectionsTable.ownerId, ownerId),
        eq(marketplaceConnectionsTable.marketplace, marketplace),
      ),
    )
    .limit(1);
  return row;
}

async function saveConnection(
  ownerId: string,
  marketplace: Marketplace,
  storeName: string,
  credentials: ConnectionCredentials,
) {
  const encrypted = encryptCredentials(credentials);
  const [row] = await db
    .insert(marketplaceConnectionsTable)
    .values({
      ownerId,
      marketplace,
      storeName,
      credentialsCiphertext: encrypted,
      lastSyncAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        marketplaceConnectionsTable.ownerId,
        marketplaceConnectionsTable.marketplace,
      ],
      set: {
        storeName,
        credentialsCiphertext: encrypted,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Не удалось получить данные площадки.";
}

function zeroSnapshot(): MarketplaceSnapshot {
  return {
    daily: new Map(),
    funnel: { orders: 0, units: 0, views: 0, cartAdds: 0 },
  };
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : 0;
}

function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

router.get("/marketplace/connections", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const rows = await db
    .select()
    .from(marketplaceConnectionsTable)
    .where(eq(marketplaceConnectionsTable.ownerId, ownerId));
  const byMarketplace = new Map(rows.map((row) => [row.marketplace, row]));
  const response = ListMarketplaceConnectionsResponse.parse([
    connectionView("ozon", byMarketplace.get("ozon")),
    connectionView("wildberries", byMarketplace.get("wildberries")),
  ]);
  res.json(response);
});

router.post("/marketplace/connections/ozon", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const parsed = ConnectOzonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Укажите Client ID и API-ключ Ozon." });
    return;
  }

  try {
    await verifyOzonCredentials(parsed.data);
  } catch (error) {
    req.log.warn({ marketplace: "ozon" }, "Marketplace credential verification failed");
    res.status(400).json({
      error: errorMessage(error),
    });
    return;
  }

  const row = await saveConnection(
    ownerId,
    "ozon",
    "Магазин Ozon",
    parsed.data,
  );
  req.log.info({ marketplace: "ozon" }, "Marketplace connected");
  res.json(ConnectOzonResponse.parse(connectionView("ozon", row)));
});

router.post(
  "/marketplace/connections/wildberries",
  async (req, res): Promise<void> => {
    const ownerId = userIdFromRequest(req);
    const parsed = ConnectWildberriesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Укажите API-ключ Wildberries." });
      return;
    }

    try {
      await verifyWildberriesCredentials(parsed.data);
    } catch (error) {
      req.log.warn(
        { marketplace: "wildberries" },
        "Marketplace credential verification failed",
      );
      res.status(400).json({ error: errorMessage(error) });
      return;
    }

    const row = await saveConnection(
      ownerId,
      "wildberries",
      "Магазин Wildberries",
      parsed.data,
    );
    req.log.info({ marketplace: "wildberries" }, "Marketplace connected");
    res.json(
      ConnectWildberriesResponse.parse(
        connectionView("wildberries", row),
      ),
    );
  },
);

router.delete(
  "/marketplace/connections/:marketplace",
  async (req, res): Promise<void> => {
    const ownerId = userIdFromRequest(req);
    const parsed = DisconnectMarketplaceParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Неизвестная торговая площадка." });
      return;
    }
    await db
      .delete(marketplaceConnectionsTable)
      .where(
        and(
          eq(marketplaceConnectionsTable.ownerId, ownerId),
          eq(marketplaceConnectionsTable.marketplace, parsed.data.marketplace),
        ),
      );
    res.sendStatus(204);
  },
);

router.get("/marketplace/dashboard", async (req, res): Promise<void> => {
  const query = GetMarketplaceDashboardQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Выберите корректный период и площадку." });
    return;
  }

  const ownerId = userIdFromRequest(req);
  const { period, marketplace } = query.data;
  const { from, to } = periodDates(period);
  const connectedRows = await db
    .select()
    .from(marketplaceConnectionsTable)
    .where(eq(marketplaceConnectionsTable.ownerId, ownerId));
  const rows = new Map(connectedRows.map((row) => [row.marketplace, row]));
  const snapshots = new Map<Marketplace, MarketplaceSnapshot>();
  const partialErrors: string[] = [];

  const targets: Marketplace[] =
    marketplace === "all"
      ? ["ozon", "wildberries"]
      : [marketplace];

  await Promise.all(
    targets.map(async (target) => {
      const connection = rows.get(target);
      if (!connection) return;

      try {
        if (target === "ozon") {
          const credentials =
            decryptCredentials<{ clientId: string; apiKey: string }>(
              connection.credentialsCiphertext,
            );
          snapshots.set(
            target,
            await getOzonSnapshot(credentials, from, to),
          );
        } else {
          const credentials = decryptCredentials<{ apiKey: string }>(
            connection.credentialsCiphertext,
          );
          snapshots.set(
            target,
            await getWildberriesSnapshot(credentials, from, to),
          );
        }
        await db
          .update(marketplaceConnectionsTable)
          .set({ lastSyncAt: new Date() })
          .where(eq(marketplaceConnectionsTable.id, connection.id));
      } catch (error) {
        req.log.warn({ marketplace: target }, "Marketplace data request failed");
        partialErrors.push(`${target === "ozon" ? "Ozon" : "Wildberries"}: ${errorMessage(error)}`);
        snapshots.set(target, zeroSnapshot());
      }
    }),
  );

  const salesSeries = datesInRange(from, to).map((date) => {
    const ozonRevenue =
      marketplace === "wildberries"
        ? 0
        : (snapshots.get("ozon")?.daily.get(date)?.revenue ?? 0);
    const wildberriesRevenue =
      marketplace === "ozon"
        ? 0
        : (snapshots.get("wildberries")?.daily.get(date)?.revenue ?? 0);
    return {
      date,
      ozonRevenue,
      wildberriesRevenue,
      totalRevenue: ozonRevenue + wildberriesRevenue,
    };
  });

  const funnels = targets
    .filter((target) => target !== "ozon")
    .map((target) => {
      const snapshot = snapshots.get(target);
      if (!snapshot) return null;
      const { views, cartAdds, orders, units } = snapshot.funnel;
      return {
        marketplace: target,
        views,
        cartAdds,
        orders,
        purchases: units,
        viewToCartPercent: percent(cartAdds, views),
        cartToOrderPercent: percent(orders, cartAdds),
        orderToPurchasePercent: percent(units, orders),
      };
    })
    .filter((funnel) => funnel !== null);

  const revenue = salesSeries.reduce((sum, day) => sum + day.totalRevenue, 0);
  const orders = funnels.reduce((sum, funnel) => sum + funnel.orders, 0);
  const units = funnels.reduce((sum, funnel) => sum + funnel.purchases, 0);
  if (snapshots.has("ozon")) {
    partialErrors.push(
      "Ozon: API-метрика ordered_units не используется как число заказов или выкупов; эти показатели пока не включены в итог.",
    );
  }
  res.json(
    GetMarketplaceDashboardResponse.parse({
      period,
      marketplace,
      revenue,
      revenueChangePercent: null,
      orders,
      units,
      // Ozon order counts are not currently sourced from a reliable metric.
      // Do not divide combined Ozon+WB revenue by a WB-only order denominator.
      averageOrderValue:
        orders > 0 && !(marketplace === "all" && snapshots.has("ozon"))
          ? revenue / orders
          : 0,
      salesSeries,
      funnels,
      partialErrors,
    }),
  );
});


router.get("/marketplace/finance/wildberries", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };

  if (!validDate(from) || !validDate(to) || from > to) {
    res.status(400).json({ error: "Укажите корректные даты начала и окончания отчёта." });
    return;
  }

  const days = Math.floor(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`))
      / 86_400_000,
  ) + 1;
  if (days > 31) {
    res.status(400).json({ error: "Для первого этапа финансовый отчёт можно запросить максимум за 31 день." });
    return;
  }

  const connection = await findConnection(ownerId, "wildberries");
  if (!connection) {
    res.status(404).json({ error: "Сначала подключите Wildberries в настройках API." });
    return;
  }

  try {
    const credentials = decryptCredentials<{ apiKey: string }>(
      connection.credentialsCiphertext,
    );
    const report = await getWildberriesFinanceReport(credentials.apiKey, from, to);
    await db
      .update(marketplaceConnectionsTable)
      .set({ lastSyncAt: new Date() })
      .where(
        and(
          eq(marketplaceConnectionsTable.id, connection.id),
          eq(marketplaceConnectionsTable.ownerId, ownerId),
        ),
      );
    req.log.info({ marketplace: "wildberries", rows: report.rowsCount }, "Finance report loaded");
    res.json(report);
  } catch (error) {
    req.log.warn({ marketplace: "wildberries" }, "Finance report request failed");
    res.status(502).json({ error: errorMessage(error) });
  }
});


router.get("/marketplace/finance/ozon", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };

  if (!validDate(from) || !validDate(to) || from > to) {
    res.status(400).json({ error: "Укажите корректные даты начала и окончания отчёта." });
    return;
  }

  const days = Math.floor(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`))
      / 86_400_000,
  ) + 1;
  if (days > 7) {
    res.status(400).json({ error: "Для последовательной выгрузки Ozon выберите период не более 7 дней." });
    return;
  }
