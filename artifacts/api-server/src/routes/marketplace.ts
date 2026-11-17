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
import { db, cogsProductsTable, marketplaceConnectionsTable, sellerExpensesTable } from "@workspace/db";
import { cogsProductMarketplacesTable } from "@workspace/db/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { requireUser } from "../middlewares/requireUser";
import {
  decryptCredentials,
  encryptCredentials,
} from "../lib/marketplace-credentials";
import {
  getOzonSnapshot,
  getWildberriesSnapshot,
  MarketplaceRateLimitError,
  periodDates,
  verifyOzonCredentials,
  verifyWildberriesCredentials,
  type MarketplaceSnapshot,
} from "../lib/marketplace-data";

type Marketplace = "ozon" | "wildberries";
type ConnectionCredentials =
  | { clientId: string; apiKey: string }
  | { apiKey: string }
  | { baseUrl: string; apiKey: string; model: string };

type AiAssistantCredentials = { baseUrl: string; apiKey: string; model: string };

const AI_CONNECTION_ID = "ai-assistant";

const DASHBOARD_CACHE_TTL = 5 * 60 * 1000;

const dashboardCache = new Map<
  string,
  { snapshot: MarketplaceSnapshot; expiresAt: number }
>();

const dashboardRequests = new Map<
  string,
  Promise<MarketplaceSnapshot>
>();
const marketplaceCooldowns = new Map<string, number>();
const FINANCE_CACHE_TTL = 10 * 60 * 1000;
const financeCache = new Map<string, { value: unknown; expiresAt: number }>();
const financeRequests = new Map<string, Promise<unknown>>();

async function getCachedFinance<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = financeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const pending = financeRequests.get(key);
  if (pending) return pending as Promise<T>;
  const request = loader().then((value) => {
    financeCache.set(key, { value, expiresAt: Date.now() + FINANCE_CACHE_TTL });
    return value;
  }).finally(() => financeRequests.delete(key));
  financeRequests.set(key, request);
  return request;
}

async function getCachedSnapshot(
  key: string,
  loader: () => Promise<MarketplaceSnapshot>,
): Promise<MarketplaceSnapshot> {
  const cached = dashboardCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  const pending = dashboardRequests.get(key);
  if (pending) return pending;

  const request = loader()
    .then((snapshot) => {
      dashboardCache.set(key, {
        snapshot,
        expiresAt: Date.now() + DASHBOARD_CACHE_TTL,
      });
      return snapshot;
    })
    .finally(() => {
      dashboardRequests.delete(key);
    });

  dashboardRequests.set(key, request);
  return request;
}

const router: IRouter = Router();
router.use("/marketplace", requireUser);

function normalizeAiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

async function fetchAiModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const modelsUrl = baseUrl.endsWith("/models") ? baseUrl : `${baseUrl}/models`;
  const response = await fetch(modelsUrl, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Провайдер отклонил API-ключ или доступ к списку моделей.");
    if (response.status === 404) throw new Error("Не найден endpoint моделей. Укажите Base URL совместимого API (обычно с /v1). ");
    throw new Error(`Провайдер вернул ошибку ${response.status} при загрузке моделей.`);
  }
  const payload: unknown = await response.json();
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(payload) ? payload : Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  const ids = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
    return id.trim() ? [id.trim()] : [];
  });
  if (!ids.length) throw new Error("Провайдер вернул пустой список моделей или неизвестный формат ответа.");
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

async function requestAiCompletion(
  config: AiAssistantCredentials,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  context: string,
): Promise<string> {
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl.slice(0, -1) : config.baseUrl;
  const endpoint = `${baseUrl}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: `Ты ИИ-помощник продавца. Отвечай на русском, понятно и по делу. Используй только предоставленные данные; если нужных данных нет, скажи об этом. Не выдумывай показатели. Контекст кабинета: ${context}` },
          ...messages,
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const outer = error && typeof error === "object" ? error as { name?: unknown; cause?: unknown } : {};
    const cause = outer.cause && typeof outer.cause === "object" ? outer.cause as { code?: unknown } : {};
    if (outer.name === "TimeoutError" || outer.name === "AbortError") {
      throw new Error("ИИ-провайдер не ответил за 60 секунд. Повторите попытку или проверьте доступность провайдера.");
    }
    const code = typeof cause.code === "string" ? cause.code : "";
    const reason: Record<string, string> = {
      ENOTFOUND: "не найден домен провайдера (DNS)",
      EAI_AGAIN: "временно не удалось найти домен провайдера (DNS)",
      ECONNREFUSED: "провайдер отклонил сетевое соединение",
      ECONNRESET: "сетевое соединение было прервано провайдером или прокси",
      SELF_SIGNED_CERT_IN_CHAIN: "сертификат HTTPS не найден в доверенных центрах сертификации Windows",
      CERT_HAS_EXPIRED: "истёк срок сертификата HTTPS",
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: "не удалось проверить сертификат HTTPS",
    };
    throw new Error(`Не удалось установить соединение с ИИ-провайдером${code && reason[code] ? `: ${reason[code]}` : ". Проверьте доступность сети и Base URL."}`);
  }
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { /* handled below */ }
  if (!response.ok) {
    const errorObject = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : {};
    const detail = typeof errorObject.message === "string" ? errorObject.message : typeof payload.message === "string" ? payload.message : "";
    const safeDetail = detail.replace(/[\r\n\t]+/g, " ").slice(0, 240);
    throw new Error(`ИИ-провайдер вернул ошибку ${response.status}${safeDetail ? `: ${safeDetail}` : ". Проверьте ключ, доступ и выбранную модель."}`);
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
  const content = message.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const textContent = content.flatMap((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? [(part as Record<string, string>).text] : []).join("\n").trim();
    if (textContent) return textContent;
  }
  throw new Error("ИИ-провайдер вернул ответ в неподдерживаемом формате.");
}

router.get("/marketplace/ai-config", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const [row] = await db.select().from(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.ownerId, ownerId),
    eq(marketplaceConnectionsTable.marketplace, AI_CONNECTION_ID),
  )).limit(1);
  if (!row) {
    res.json({ configured: false, baseUrl: "", model: "", apiKeyConfigured: false });
    return;
  }
  const credentials = decryptCredentials<AiAssistantCredentials>(row.credentialsCiphertext);
  res.json({ configured: true, baseUrl: credentials.baseUrl, model: credentials.model, apiKeyConfigured: Boolean(credentials.apiKey) });
});

router.post("/marketplace/ai-models", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const baseUrl = normalizeAiBaseUrl(req.body?.baseUrl);
  if (!baseUrl) {
    res.status(400).json({ error: "Укажите корректный Base URL по HTTPS, например https://api.openai.com/v1." });
    return;
  }
  let apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (apiKey.length > 2000) {
    res.status(400).json({ error: "API-ключ слишком длинный." });
    return;
  }
  if (!apiKey) {
    const [row] = await db.select().from(marketplaceConnectionsTable).where(and(
      eq(marketplaceConnectionsTable.ownerId, ownerId),
      eq(marketplaceConnectionsTable.marketplace, AI_CONNECTION_ID),
    )).limit(1);
    if (row) apiKey = decryptCredentials<AiAssistantCredentials>(row.credentialsCiphertext).apiKey;
  }
  if (!apiKey) {
    res.status(400).json({ error: "Введите API-ключ, чтобы загрузить список моделей." });
    return;
  }
  try {
    res.json({ models: await fetchAiModels(baseUrl, apiKey) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Не удалось получить список моделей." });
  }
});

router.put("/marketplace/ai-config", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const baseUrl = normalizeAiBaseUrl(req.body?.baseUrl);
  const model = typeof req.body?.model === "string" ? req.body.model.trim() : "";
  let apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!baseUrl || !model || model.length > 300 || apiKey.length > 2000) {
    res.status(400).json({ error: "Укажите Base URL, выберите модель и проверьте API-ключ." });
    return;
  }
  const [existing] = await db.select().from(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.ownerId, ownerId),
    eq(marketplaceConnectionsTable.marketplace, AI_CONNECTION_ID),
  )).limit(1);
  if (!apiKey && existing) apiKey = decryptCredentials<AiAssistantCredentials>(existing.credentialsCiphertext).apiKey;
  if (!apiKey) {
    res.status(400).json({ error: "Введите API-ключ провайдера." });
    return;
  }
  const ciphertext = encryptCredentials({ baseUrl, apiKey, model });
  await db.insert(marketplaceConnectionsTable).values({
    ownerId,
    marketplace: AI_CONNECTION_ID,
    storeName: "ИИ-помощник",
    credentialsCiphertext: ciphertext,
    lastSyncAt: new Date(),
  }).onConflictDoUpdate({
    target: [marketplaceConnectionsTable.ownerId, marketplaceConnectionsTable.marketplace],
    set: { storeName: "ИИ-помощник", credentialsCiphertext: ciphertext, lastSyncAt: new Date(), updatedAt: new Date() },
  });
  res.json({ configured: true, baseUrl, model, apiKeyConfigured: true });
});

router.delete("/marketplace/ai-config", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  await db.delete(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.ownerId, ownerId),
    eq(marketplaceConnectionsTable.marketplace, AI_CONNECTION_ID),
  ));
  res.status(204).end();
});

router.post("/marketplace/ai-chat", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const [row] = await db.select().from(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.ownerId, ownerId),
    eq(marketplaceConnectionsTable.marketplace, AI_CONNECTION_ID),
  )).limit(1);
  if (!row) {
    res.status(409).json({ error: "ИИ-помощник не подключён. Настройте провайдера в разделе «Настройки → ИИ-помощник»." });
    return;
  }
  const rawMessages: unknown = req.body?.messages;
  const rawContext: unknown = req.body?.context;
  if (!Array.isArray(rawMessages) || typeof rawContext !== "string" || rawContext.length > 20_000) {
    res.status(400).json({ error: "Передан некорректный контекст чата." });
    return;
  }
  const messages: Array<{ role: "user" | "assistant"; content: string }> = rawMessages.slice(-10).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") return [];
    const content = entry.content.trim().slice(0, 2000);
    return content ? [{ role: entry.role as "user" | "assistant", content }] : [];
  });
  if (!messages.length || messages[messages.length - 1]?.role !== "user") {
    res.status(400).json({ error: "Введите вопрос для ИИ-помощника." });
    return;
  }
  const credentials = decryptCredentials<AiAssistantCredentials>(row.credentialsCiphertext);
  try {
    res.json({ answer: await requestAiCompletion(credentials, messages, rawContext) });
  } catch (error) {
    req.log.warn({ providerHost: new URL(credentials.baseUrl).host, err: error }, "AI provider request failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "Не удалось получить ответ ИИ." });
  }
});

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
        const cooldownKey = `${ownerId}:${target}:${connection.id}`;
        const cooldownUntil = marketplaceCooldowns.get(cooldownKey) ?? 0;
        if (cooldownUntil > Date.now()) {
          const remainingSeconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
          const wait = remainingSeconds >= 3600
            ? `${Math.ceil(remainingSeconds / 3600)} ч.`
            : remainingSeconds >= 60
              ? `${Math.ceil(remainingSeconds / 60)} мин.`
              : `${remainingSeconds} сек.`;
          partialErrors.push(`Wildberries: API временно ограничил запросы. Повторите через ${wait}.`);
          snapshots.set(target, zeroSnapshot());
          return;
        }
        const cacheKey = [
          ownerId,
          target,
          connection.id,
          connection.updatedAt.getTime(),
          from,
          to,
        ].join(":");

        if (target === "ozon") {
          const credentials =
            decryptCredentials<{ clientId: string; apiKey: string }>(
              connection.credentialsCiphertext,
            );
          snapshots.set(
            target,
            await getCachedSnapshot(
              cacheKey,
              () => getOzonSnapshot(credentials, from, to),
            ),
          );
        } else {
          const credentials = decryptCredentials<{ apiKey: string }>(
            connection.credentialsCiphertext,
          );
          snapshots.set(
            target,
            await getCachedSnapshot(
              cacheKey,
              () => getWildberriesSnapshot(credentials, from, to),
            ),
          );
        }
        await db
          .update(marketplaceConnectionsTable)
          .set({ lastSyncAt: new Date() })
          .where(eq(marketplaceConnectionsTable.id, connection.id));
      } catch (error) {
        if (target === "wildberries" && error instanceof MarketplaceRateLimitError) {
          marketplaceCooldowns.set(
            `${ownerId}:${target}:${connection.id}`,
            Date.now() + error.retryAfterSeconds * 1000,
          );
          const wait = error.retryAfterSeconds >= 3600
            ? `${Math.ceil(error.retryAfterSeconds / 3600)} ч.`
            : error.retryAfterSeconds >= 60
              ? `${Math.ceil(error.retryAfterSeconds / 60)} мин.`
              : `${error.retryAfterSeconds} сек.`;
          partialErrors.push(`Wildberries: API временно ограничил запросы (429). Подключение активно; повторите через ${wait}.`);
          snapshots.set(target, zeroSnapshot());
          return;
        }
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
  const orders = funnels.reduce((sum, funnel) => sum + (funnel.marketplace === "wildberries" ? funnel.orders : 0), 0);
  const units = funnels.reduce((sum, funnel) => sum + (funnel.marketplace === "wildberries" ? funnel.purchases : 0), 0);
  if (snapshots.has("ozon")) {
    partialErrors.push(
      "Ozon: в воронке показаны заказанные единицы (ordered_units), а не число заказов. Данные о выкупах этим методом не предоставляются.",
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
    const report = await getCachedFinance(
      `${ownerId}:wildberries:${connection.id}:${connection.updatedAt.getTime()}:${from}:${to}`,
      () => getWildberriesFinanceReport(credentials.apiKey, from, to),
    ) as Awaited<ReturnType<typeof getWildberriesFinanceReport>>;
    const [catalogProducts, marketplaceProducts] = await Promise.all([
      db.select({ id: cogsProductsTable.id, sellerSku: cogsProductsTable.sellerSku, marketplace: cogsProductsTable.marketplace, unitCost: cogsProductsTable.unitCost })
        .from(cogsProductsTable).where(eq(cogsProductsTable.ownerId, ownerId)),
      db.select({ productId: cogsProductMarketplacesTable.productId, marketplaceSku: cogsProductMarketplacesTable.marketplaceSku, externalProductId: cogsProductMarketplacesTable.externalProductId })
        .from(cogsProductMarketplacesTable).where(and(
          eq(cogsProductMarketplacesTable.ownerId, ownerId),
          eq(cogsProductMarketplacesTable.marketplace, "wildberries"),
        )),
    ]);
    const productsById = new Map(catalogProducts.map((product) => [product.id, product]));
    const productBySellerSku = new Map<string, typeof catalogProducts[number]>();
    const productByExternalId = new Map<string, typeof catalogProducts[number]>();
    for (const link of marketplaceProducts) {
      const product = productsById.get(link.productId);
      if (!product) continue;
      if (link.marketplaceSku) productBySellerSku.set(link.marketplaceSku.trim().toLocaleLowerCase("ru-RU"), product);
      if (link.externalProductId) productByExternalId.set(link.externalProductId.trim(), product);
    }
    for (const product of catalogProducts) {
      if (product.marketplace === "both" || product.marketplace === "wildberries") {
        const key = product.sellerSku.trim().toLocaleLowerCase("ru-RU");
        if (key && !productBySellerSku.has(key)) productBySellerSku.set(key, product);
      }
    }
    let matchedUnits = 0;
    let unmatchedUnits = 0;
    let costOfGoods = 0;
    for (const soldItem of report.soldItems) {
      const product = productBySellerSku.get(soldItem.sellerSku.trim().toLocaleLowerCase("ru-RU"))
        ?? productByExternalId.get(soldItem.externalProductId);
      if (!product) { unmatchedUnits += soldItem.quantity; continue; }
      matchedUnits += soldItem.quantity;
      costOfGoods += Number(product.unitCost) * soldItem.quantity;
    }
    report.catalogCost = {
      matchedUnits,
      unmatchedUnits,
      costOfGoods: Math.round(costOfGoods * 100) / 100,
    };
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

  const connection = await findConnection(ownerId, "ozon");
  if (!connection) {
    res.status(404).json({ error: "Сначала подключите Ozon в настройках API." });
    return;
  }

  try {
    const credentials = decryptCredentials<{ clientId: string; apiKey: string }>(
      connection.credentialsCiphertext,
    );
    const report = await getCachedFinance(
      `${ownerId}:ozon:${connection.id}:${connection.updatedAt.getTime()}:${from}:${to}`,
      () => getOzonFinanceReport(credentials, from, to),
    ) as Awaited<ReturnType<typeof getOzonFinanceReport>>;
    await db
      .update(marketplaceConnectionsTable)
      .set({ lastSyncAt: new Date() })
      .where(
        and(
          eq(marketplaceConnectionsTable.id, connection.id),
          eq(marketplaceConnectionsTable.ownerId, ownerId),
        ),
      );
    req.log.info({ marketplace: "ozon", accruals: report.totals.accrualsCount }, "Finance report loaded");
    res.json(report);
  } catch (error) {
    req.log.warn({ marketplace: "ozon" }, "Finance report request failed");
    res.status(502).json({ error: errorMessage(error) });
  }
});

router.get("/marketplace/finance/expenses", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
  if (!validDate(from) || !validDate(to) || from > to) { res.status(400).json({ error: "Укажите корректный период расходов." }); return; }
  const expenses = await db.select().from(sellerExpensesTable).where(and(
    eq(sellerExpensesTable.ownerId, ownerId),
    gte(sellerExpensesTable.expenseDate, from),
    lte(sellerExpensesTable.expenseDate, to),
  )).orderBy(desc(sellerExpensesTable.expenseDate), desc(sellerExpensesTable.createdAt));
  const total = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  res.json({ expenses, total: Math.round(total * 100) / 100, from, to });
});

router.post("/marketplace/finance/expenses", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const expenseDate = typeof body.expenseDate === "string" ? body.expenseDate.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim().slice(0, 80) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 300) : "";
  const amount = typeof body.amount === "number" ? String(body.amount) : typeof body.amount === "string" ? body.amount.trim().replace(",", ".") : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || Number.isNaN(Date.parse(`${expenseDate}T00:00:00.000Z`))) {
    res.status(400).json({ error: "Укажите корректную дату расхода." }); return;
  }
  if (!category) { res.status(400).json({ error: "Укажите категорию расхода." }); return; }
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    res.status(400).json({ error: "Сумма расхода должна быть больше нуля." }); return;
  }
  const [expense] = await db.insert(sellerExpensesTable).values({
    ownerId, expenseDate, category, description, amount,
  }).returning();
  res.status(201).json(expense);
});

router.delete("/marketplace/finance/expenses/:id", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Некорректный расход." }); return;
  }
  const deleted = await db.delete(sellerExpensesTable).where(and(
    eq(sellerExpensesTable.ownerId, ownerId), eq(sellerExpensesTable.id, id),
  )).returning({ id: sellerExpensesTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Расход не найден." }); return; }
  res.status(204).end();
});

export default router;
