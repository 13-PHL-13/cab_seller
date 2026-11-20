import { SyncDeferred, mergeSyncStatuses } from '../lib/sync-context';
import { sharedDataset, sharedSnapshot, datasetStatuses } from '../lib/marketplace-sync';
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
import { db, aiConversationsTable, aiMessagesTable, cogsProductsTable, marketplaceConnectionsTable, sellerExpensesTable } from "@workspace/db";
import { routerBalance } from '../lib/ai-balance';
import { dashboardWindow, dashboardStoreData } from '../lib/dashboard-layout';
import { cogsProductMarketplacesTable } from "@workspace/db/schema";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { requireUser } from "../middlewares/requireUser";
import { requireCompanyFinance, requireCompanySection, requireMarketplaceAccess } from "../middlewares/requireCompanyAccess";
import {
  decryptCredentials,
  encryptCredentials,
} from "../lib/marketplace-credentials";
import {
  periodDates,
  verifyOzonCredentials,
  verifyWildberriesCredentials,
  type MarketplaceSnapshot,
} from "../lib/marketplace-data";

import { parsePerformanceCredentials, verifyPerformanceCredentials, performanceConfigured, type OzonStoreCredentials } from "../lib/ozon-performance";

type Marketplace = "ozon" | "wildberries";
type ConnectionCredentials =
  | OzonStoreCredentials
  | { apiKey: string }
  | { baseUrl: string; apiKey: string; model: string };

type AiAssistantCredentials = { baseUrl: string; apiKey: string; model: string };

const AI_CONNECTION_ID = "ai-assistant";

const router: IRouter = Router();
router.use("/marketplace", requireUser);
router.use("/marketplace/finance", requireCompanyFinance);
router.use("/marketplace/dashboard", requireCompanySection("dashboard"));
router.use("/marketplace/connections", requireMarketplaceAccess);
router.use("/marketplace/stores", requireMarketplaceAccess);
router.use("/marketplace/ai-config", requireCompanySection("settings"));
router.use("/marketplace/ai-models", requireCompanySection("settings"));
router.use("/marketplace/ai-chat", requireCompanySection("dashboard"));
router.use("/marketplace/ai-status", requireCompanySection("dashboard"));

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
    eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
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
      eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
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
    eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
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
    companyId: companyIdFromRequest(req),
    marketplace: AI_CONNECTION_ID,
    storeName: "ИИ-помощник",
    credentialsCiphertext: ciphertext,
    lastSyncAt: new Date(),
  }).onConflictDoUpdate({
    target: [marketplaceConnectionsTable.companyId, marketplaceConnectionsTable.marketplace, marketplaceConnectionsTable.storeName],
    set: { credentialsCiphertext: ciphertext, lastSyncAt: new Date(), updatedAt: new Date() },
  });
  res.json({ configured: true, baseUrl, model, apiKeyConfigured: true });
});

router.delete("/marketplace/ai-config", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  await db.delete(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
    eq(marketplaceConnectionsTable.marketplace, AI_CONNECTION_ID),
  ));
  res.status(204).end();
});

router.get('/marketplace/ai-status', async (req, res): Promise<void> => {
  const [row] = await db.select().from(marketplaceConnectionsTable).where(and(eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)), eq(marketplaceConnectionsTable.marketplace, AI_CONNECTION_ID))).limit(1);
  if (!row) { res.json({ configured: false, model: '', balance: null, currency: null, tokensRemaining: null, expiresAt: null }); return; }
  const config = decryptCredentials<AiAssistantCredentials>(row.credentialsCiphertext);
  let balance: number | null = null;
  const maySeeBalance = req.companyRole === 'owner' || req.companyRole === 'admin' || req.companyPermissions?.canSeeFinance;
  if (maySeeBalance && new URL(config.baseUrl).origin === 'https://routerai.ru') { try { balance = await routerBalance(config.apiKey); } catch { /* An unavailable balance is not zero. */ } }
  res.json({ configured: true, model: config.model, balance, currency: balance === null ? null : 'RUB', tokensRemaining: null, expiresAt: null, tokenLimit: req.companyPermissions?.tokenLimit ?? null });
});

router.get('/marketplace/ai-chat/list', async (req, res): Promise<void> => {
  const chats = await db.select({ id: aiConversationsTable.id, title: aiConversationsTable.title, archived: aiConversationsTable.archived, context: aiConversationsTable.context, updatedAt: aiConversationsTable.updatedAt }).from(aiConversationsTable).where(and(eq(aiConversationsTable.companyId, companyIdFromRequest(req)), eq(aiConversationsTable.createdBy, userIdFromRequest(req)))).orderBy(desc(aiConversationsTable.updatedAt));
  res.json({ chats });
});
router.patch('/marketplace/ai-chat/:id', async (req, res): Promise<void> => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.status(404).json({ error: 'Чат не найден.' }); return; }
  const update: Partial<typeof aiConversationsTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof req.body?.title === 'string' && req.body.title.trim()) update.title = req.body.title.trim().slice(0,120);
  if (typeof req.body?.archived === 'boolean') update.archived = req.body.archived;
  const [chat] = await db.update(aiConversationsTable).set(update).where(and(eq(aiConversationsTable.id,req.params.id),eq(aiConversationsTable.companyId,companyIdFromRequest(req)),eq(aiConversationsTable.createdBy,userIdFromRequest(req)))).returning({ id: aiConversationsTable.id });
  res.status(chat ? 200 : 404).json(chat ?? { error: 'Чат не найден.' });
});
router.get("/marketplace/ai-chat", async (req, res): Promise<void> => {
  const requestedId = typeof req.query.id === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.id) ? req.query.id : null;
  const [conversation] = await db.select().from(aiConversationsTable).where(and(eq(aiConversationsTable.companyId, companyIdFromRequest(req)),eq(aiConversationsTable.createdBy,userIdFromRequest(req)), ...(requestedId ? [eq(aiConversationsTable.id,requestedId)] : [eq(aiConversationsTable.archived,false)])))
    .orderBy(desc(aiConversationsTable.updatedAt)).limit(1);
  if (!conversation) { res.json({ conversationId: null, messages: [] }); return; }
  const messages = await db.select().from(aiMessagesTable).where(eq(aiMessagesTable.conversationId, conversation.id))
    .orderBy(aiMessagesTable.createdAt).limit(100);
  res.json({ conversationId: conversation.id, title: conversation.title, context: conversation.context, messages });
});

router.post("/marketplace/ai-chat/new", async (req, res): Promise<void> => {
  const [conversation] = await db.insert(aiConversationsTable).values({
    companyId: companyIdFromRequest(req), createdBy: userIdFromRequest(req),
    context: typeof req.body?.context === "string" ? req.body.context.slice(0, 20_000) : "{}",
    title: typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0,120) : 'Новый диалог',
  }).returning({ id: aiConversationsTable.id });
  res.status(201).json({ conversationId: conversation.id });
});

router.post("/marketplace/ai-chat", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const [row] = await db.select().from(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
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
    const answer = await requestAiCompletion(credentials, messages, rawContext);
    const requestedConversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId : "";
    let conversationId = "";
    if (requestedConversationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedConversationId)) {
      const [existing] = await db.select({ id: aiConversationsTable.id }).from(aiConversationsTable).where(and(
        eq(aiConversationsTable.id, requestedConversationId), eq(aiConversationsTable.companyId, companyIdFromRequest(req)), eq(aiConversationsTable.createdBy, ownerId), eq(aiConversationsTable.archived, false),
      )).limit(1);
      conversationId = existing?.id ?? "";
    }
    const lastQuestion = messages[messages.length - 1]!.content;
    if (!conversationId) {
      const [conversation] = await db.insert(aiConversationsTable).values({
        companyId: companyIdFromRequest(req), createdBy: userIdFromRequest(req),
        title: lastQuestion.slice(0, 120), context: rawContext,
      }).returning({ id: aiConversationsTable.id });
      conversationId = conversation.id;
    } else {
      await db.update(aiConversationsTable).set({ context: rawContext, title: sql`CASE WHEN ${aiConversationsTable.title} = 'Новый диалог' THEN ${lastQuestion.slice(0,120)} ELSE ${aiConversationsTable.title} END`, updatedAt: new Date() }).where(and(
        eq(aiConversationsTable.id, conversationId), eq(aiConversationsTable.companyId, companyIdFromRequest(req)),
      ));
    }
    await db.insert(aiMessagesTable).values([
      { conversationId, role: "user", content: lastQuestion },
      { conversationId, role: "assistant", content: answer },
    ]);
    res.json({ answer, conversationId });
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

function companyIdFromRequest(req: Express.Request): string {
  if (!req.companyId) throw new Error("Active company is missing");
  return req.companyId;
}

function storeIdFromRequest(req: import("express").Request): number | null {
  const value = typeof req.query.storeId === "string" ? Number(req.query.storeId) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

function allowedStoreIds(req: import("express").Request): string[] | "all" {
  const value = req.companyPermissions?.storeAccess;
  return value === "all" || !Array.isArray(value) ? "all" : value;
}

function connectionView(
  marketplace: Marketplace,
  row?: typeof marketplaceConnectionsTable.$inferSelect,
) {
  return {
    id: row?.id ?? null,
    marketplace,
    connected: Boolean(row),
    storeName: row?.storeName ?? null,
    lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
    statusMessage: row ? "Подключено" : null,
  };
}

async function findConnections(ownerId: string, marketplace: Marketplace, storeId?: number | null, allowed: string[] | "all" = "all") {
  if (storeId && Array.isArray(allowed) && !allowed.includes(String(storeId))) return undefined;
  if (!storeId && Array.isArray(allowed) && !allowed.length) return undefined;
  return db
    .select()
    .from(marketplaceConnectionsTable)
    .where(
      and(
        eq(marketplaceConnectionsTable.companyId, ownerId),
        eq(marketplaceConnectionsTable.marketplace, marketplace),
        ...(storeId ? [eq(marketplaceConnectionsTable.id, storeId)] : []),
        ...(!storeId && Array.isArray(allowed) ? [inArray(marketplaceConnectionsTable.id, allowed.map(Number))] : []),
      ),
    )
    .orderBy(asc(marketplaceConnectionsTable.id));
}

router.get('/marketplace/sync-status', requireCompanySection('dashboard'), async (req,res):Promise<void>=>{
  const visible = (await Promise.all((['ozon','wildberries'] as const).map(marketplace =>
    findConnections(companyIdFromRequest(req), marketplace, storeIdFromRequest(req), allowedStoreIds(req))
  ))).flatMap(connections=>connections??[]);
  res.setHeader('Cache-Control','private, no-store');
  res.json({datasets:await datasetStatuses(visible.map(connection=>connection.id))});
});

async function saveConnection(
  ownerId: string,
  companyId: string,
  marketplace: Marketplace,
  storeName: string,
  credentials: ConnectionCredentials,
  createOnly = false,
) {
  const encrypted = encryptCredentials(credentials);
  const insert = db
    .insert(marketplaceConnectionsTable)
    .values({
      ownerId,
      companyId,
      marketplace,
      storeName,
      credentialsCiphertext: encrypted,
      lastSyncAt: new Date(),
    });
  const [row] = await (createOnly ? insert.onConflictDoNothing() : insert.onConflictDoUpdate({
      target: [
        marketplaceConnectionsTable.companyId,
        marketplaceConnectionsTable.marketplace,
        marketplaceConnectionsTable.storeName,
      ],
      set: {
        storeName,
        credentialsCiphertext: encrypted,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    }))
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
  const selected = storeIdFromRequest(req);
  const allowed = allowedStoreIds(req);
  if (selected && Array.isArray(allowed) && !allowed.includes(String(selected))) { res.status(403).json({ error: "У вашей роли нет доступа к этому магазину." }); return; }
  const rows = await db
    .select()
    .from(marketplaceConnectionsTable)
    .where(and(eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
      ...(selected ? [eq(marketplaceConnectionsTable.id, selected)] : []),
      ...(!selected && Array.isArray(allowed) ? [inArray(marketplaceConnectionsTable.id, allowed.map(Number))] : []),
    )).orderBy(asc(marketplaceConnectionsTable.id));
  const byMarketplace = new Map<string, typeof rows[number]>();
  for (const row of rows) if (!byMarketplace.has(row.marketplace)) byMarketplace.set(row.marketplace, row);
  const response = ListMarketplaceConnectionsResponse.parse([
    connectionView("ozon", byMarketplace.get("ozon")),
    connectionView("wildberries", byMarketplace.get("wildberries")),
  ]);
  res.json(response);
});

router.get("/marketplace/stores", async (req, res): Promise<void> => {
  const rows = await db.select({ id: marketplaceConnectionsTable.id, marketplace: marketplaceConnectionsTable.marketplace, storeName: marketplaceConnectionsTable.storeName, lastSyncAt: marketplaceConnectionsTable.lastSyncAt, credentialsCiphertext: marketplaceConnectionsTable.credentialsCiphertext })
    .from(marketplaceConnectionsTable).where(and(
      eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
      inArray(marketplaceConnectionsTable.marketplace, ["ozon", "wildberries"]),
    )).orderBy(marketplaceConnectionsTable.marketplace, marketplaceConnectionsTable.storeName);
  const allowed = allowedStoreIds(req);
  res.json({ stores: rows.filter((row) => allowed === "all" || allowed.includes(String(row.id))).map((row) => ({ id: row.id, marketplace: row.marketplace, storeName: row.storeName, lastSyncAt: row.lastSyncAt?.toISOString() ?? null, performanceConnected: row.marketplace === "ozon" && performanceConfigured(decryptCredentials<OzonStoreCredentials>(row.credentialsCiphertext)) })) });
});

router.put("/marketplace/stores/:id/ozon-performance", async (req, res): Promise<void> => {
  const id = Number(req.params.id), allowed = allowedStoreIds(req);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Некорректный магазин." }); return; }
  if (Array.isArray(allowed) && !allowed.includes(String(id))) { res.status(404).json({ error: "Магазин не найден." }); return; }
  const performance = parsePerformanceCredentials(req.body);
  if (!performance) { res.status(400).json({ error: "Укажите Client ID и Client Secret от Performance API." }); return; }
  const [row] = await db.select().from(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.id, id), eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
    eq(marketplaceConnectionsTable.marketplace, "ozon"),
  )).limit(1);
  if (!row) { res.status(404).json({ error: "Магазин не найден." }); return; }
  try { await verifyPerformanceCredentials(performance); }
  catch (error) { res.status(400).json({ error: errorMessage(error) }); return; }
  // Lock and reread: concurrent Seller API updates must not be overwritten.
  const saved = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(marketplaceConnectionsTable).where(and(
      eq(marketplaceConnectionsTable.id, id), eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
      eq(marketplaceConnectionsTable.marketplace, "ozon"),
    )).for("update").limit(1);
    if (!current) return false;
    const credentials = decryptCredentials<OzonStoreCredentials>(current.credentialsCiphertext);
    await tx.update(marketplaceConnectionsTable).set({
      credentialsCiphertext: encryptCredentials({ ...credentials, performance }), updatedAt: new Date(),
    }).where(and(eq(marketplaceConnectionsTable.id, id), eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req))));
    return true;
  });
  if (!saved) { res.status(404).json({ error: "Магазин не найден." }); return; }
  res.json({ connected: true });
});

router.delete("/marketplace/stores/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Некорректный магазин." }); return; }
  const allowed = allowedStoreIds(req);
  if (Array.isArray(allowed) && !allowed.includes(String(id))) { res.status(404).json({ error: "Магазин не найден." }); return; }
  const [removed] = await db.delete(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.id, id), eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
    inArray(marketplaceConnectionsTable.marketplace, ["ozon", "wildberries"]),
  )).returning({ id: marketplaceConnectionsTable.id });
  if (!removed) { res.status(404).json({ error: "Магазин не найден." }); return; }
  res.sendStatus(204);
});

router.post("/marketplace/connections/ozon", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const parsed = ConnectOzonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Укажите ключи обоих блоков Ozon: Seller API и Performance API." });
    return;
  }
  const performance = parsePerformanceCredentials(parsed.data.performance);
  if (!performance) { res.status(400).json({ error: "Укажите отдельные Client ID и Client Secret от Performance API." }); return; }
  parsed.data.performance = performance;

  try {
    await verifyOzonCredentials(parsed.data);
    await verifyPerformanceCredentials(parsed.data.performance);
  } catch (error) {
    req.log.warn({ marketplace: "ozon" }, "Marketplace credential verification failed");
    res.status(400).json({
      error: "Не удалось проверить доступ Ozon. Проверьте ключи Seller API и Performance API и повторите подключение позже.",
    });
    return;
  }

  const storeName = typeof req.body?.storeName === "string" ? req.body.storeName.trim().slice(0, 120) : "";
  const row = await saveConnection(
    ownerId,
    companyIdFromRequest(req),
    "ozon",
    storeName || "Магазин Ozon",
    parsed.data,
    true,
  );
  if (!row) { res.status(409).json({ error: "Магазин с таким названием уже добавлен. Performance API можно добавить в его карточке." }); return; }
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

    const storeName = typeof req.body?.storeName === "string" ? req.body.storeName.trim().slice(0, 120) : "";
    const row = await saveConnection(
      ownerId,
      companyIdFromRequest(req),
      "wildberries",
      storeName || "Магазин Wildberries",
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
          eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
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
  const { from, to } = req.query.layout === 'prototype'
    ? dashboardWindow(req.query.view === 'previous' ? 'previous' : 'current') : periodDates(period);
  const requestedStoreId = storeIdFromRequest(req);
  if (req.query.storeId !== undefined && !requestedStoreId) { res.status(400).json({ error: "Выбран некорректный магазин." }); return; }
  const allowedStores = allowedStoreIds(req);
  if (requestedStoreId && Array.isArray(allowedStores) && !allowedStores.includes(String(requestedStoreId))) { res.status(403).json({ error: "У вашей роли нет доступа к этому магазину." }); return; }
  const connectedRows = await db
    .select()
    .from(marketplaceConnectionsTable)
    .where(and(eq(marketplaceConnectionsTable.companyId, companyIdFromRequest(req)),
      ...(requestedStoreId ? [eq(marketplaceConnectionsTable.id, requestedStoreId)] : []),
      ...(!requestedStoreId && Array.isArray(allowedStores) ? [inArray(marketplaceConnectionsTable.id, allowedStores.map(Number))] : []),
    )).orderBy(asc(marketplaceConnectionsTable.id));
  const rows = new Map<Marketplace, Array<typeof connectedRows[number]>>();
  for (const row of connectedRows) {
    if (row.marketplace === "ozon" || row.marketplace === "wildberries") rows.set(row.marketplace, [...(rows.get(row.marketplace) ?? []), row]);
  }
  const snapshots = new Map<Marketplace, MarketplaceSnapshot>();
  const partialErrors: string[] = [];
  const storeDetails: Array<{id:number;storeName:string;marketplace:Marketplace;data:ReturnType<typeof dashboardStoreData>}> = [];

  const targets: Marketplace[] =
    marketplace === "all"
      ? ["ozon", "wildberries"]
      : [marketplace];

  await Promise.all(
    targets.map(async (target) => {
      const connections = rows.get(target) ?? [];
      if (!connections.length) return;
      const combined = zeroSnapshot();
      for (const connection of connections) {
        try {
          // Ozon validates against its server day, which may lag the company calendar.
          const requestTo = target === 'ozon' && req.query.layout === 'prototype'
            ? [to, new Date().toISOString().slice(0, 10)].sort()[0] : to;
          const snapshot = await sharedSnapshot(connection, from, requestTo);
          if (snapshot.sync.stale) {
            const asOf = snapshot.sync.updatedAt ? new Date(snapshot.sync.updatedAt).toLocaleString('ru-RU', {timeZone:'Asia/Yekaterinburg'}) : 'частичной загрузки';
            const update = snapshot.sync.state==='blocked' ? 'Обновление остановлено: нужна проверка ответа площадки и прав ключа.' : `Следующая проверка — ${new Date(snapshot.sync.nextAttemptAt).toLocaleString('ru-RU', {timeZone:'Asia/Yekaterinburg'})}.`;
            partialErrors.push(`${target === "ozon" ? "Ozon" : "ВБ"} · ${connection.storeName}: показаны данные ${asOf}. ${update}`);
          }
          const detail = dashboardStoreData(snapshot,target);
          for(const warning of Object.values(snapshot.unavailable??{}))partialErrors.push(`${target === "ozon" ? "Ozon" : "ВБ"} · ${connection.storeName}: ${warning}`);
          if (requestTo !== to) {
            for (const key of Object.keys(detail.totals) as Array<keyof typeof detail.totals>) detail.totals[key] = null;
          }
          if (!['owner','admin'].includes(req.companyRole??'') && !req.companyPermissions?.canSeeFinance) {
            detail.totals.orderAmount=null;detail.totals.boughtAmount=null;
            for(const point of detail.daily){point.orderAmount=null;point.boughtAmount=null;}
          }
          storeDetails.push({id:connection.id,storeName:connection.storeName,marketplace:target,data:detail});
          for (const [date, point] of snapshot.daily) {
            const previous = combined.daily.get(date) ?? { ...point, date, revenue: 0, orders: 0, units: 0, views: 0, cartAdds: 0 };
            combined.daily.set(date, {
              date, revenue: previous.revenue + point.revenue, orders: previous.orders + point.orders,
              units: previous.units + point.units, views: previous.views + point.views, cartAdds: previous.cartAdds + point.cartAdds,
            });
          }
          combined.funnel.views += snapshot.funnel.views; combined.funnel.cartAdds += snapshot.funnel.cartAdds;
          combined.funnel.orders += snapshot.funnel.orders; combined.funnel.units += snapshot.funnel.units;

        } catch (error) {
          partialErrors.push(`${target === "ozon" ? "Ozon" : "ВБ"} · ${connection.storeName}: ${errorMessage(error)}`);
        }
      }
      snapshots.set(target, combined);
    }),
  );

  if (req.query.layout === 'prototype') {
    res.json({from,to,stores:storeDetails,partialErrors}); return;
  }
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

  const connections = await findConnections(companyIdFromRequest(req), "wildberries", storeIdFromRequest(req), allowedStoreIds(req));
  if (!connections?.length) {
    res.status(404).json({ error: "Сначала подключите Wildberries в настройках API." });
    return;
  }

  try {
    const reports = await Promise.all(connections.map(connection => sharedDataset<Awaited<ReturnType<typeof getWildberriesFinanceReport>>>(connection, "finance", { from, to })));
    const totalKeys = Object.keys(reports[0]!.totals) as Array<keyof typeof reports[number]["totals"]>;
    const report = {
      ...reports[0]!, sync: mergeSyncStatuses(reports.map(item=>item.sync)), rowsCount: reports.reduce((sum, item) => sum + item.rowsCount, 0),
      incomplete: reports.some((item) => item.incomplete), soldItems: reports.flatMap((item) => item.soldItems),
      totals: Object.fromEntries(totalKeys.map((key) => [key, reports.reduce((sum, item) => sum + item.totals[key], 0)])) as typeof reports[number]["totals"],
    };
    const [catalogProducts, marketplaceProducts] = await Promise.all([
      db.select({ id: cogsProductsTable.id, sellerSku: cogsProductsTable.sellerSku, marketplace: cogsProductsTable.marketplace, unitCost: cogsProductsTable.unitCost })
        .from(cogsProductsTable).where(eq(cogsProductsTable.companyId, companyIdFromRequest(req))),
      db.select({ productId: cogsProductMarketplacesTable.productId, marketplaceSku: cogsProductMarketplacesTable.marketplaceSku, externalProductId: cogsProductMarketplacesTable.externalProductId })
        .from(cogsProductMarketplacesTable).where(and(
          eq(cogsProductMarketplacesTable.companyId, companyIdFromRequest(req)),
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
    req.log.info({ marketplace: "wildberries", rows: report.rowsCount }, "Finance report loaded");
    res.json(report);
  } catch (error) {
    req.log.warn({ marketplace: "wildberries" }, "Finance report request failed");
    if (error instanceof SyncDeferred) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((error.retryAt-Date.now())/1000))));
      res.status(503).json({ error: error.message, syncPending: true, nextAttemptAt: new Date(error.retryAt).toISOString() });
    } else res.status(502).json({ error: errorMessage(error) });
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

  const connections = await findConnections(companyIdFromRequest(req), "ozon", storeIdFromRequest(req), allowedStoreIds(req));
  if (!connections?.length) {
    res.status(404).json({ error: "Сначала подключите Ozon в настройках API." });
    return;
  }

  try {
    const reports = await Promise.all(connections.map(connection => sharedDataset<Awaited<ReturnType<typeof getOzonFinanceReport>>>(connection, "finance", { from, to })));
    const totalKeys = Object.keys(reports[0]!.totals) as Array<keyof typeof reports[number]["totals"]>;
    const report: typeof reports[number] & { catalogCost: { matchedUnits: number; unmatchedUnits: number; costOfGoods: number } } = {
      ...reports[0]!, sync: mergeSyncStatuses(reports.map(item=>item.sync)), soldItems: reports.flatMap((item) => item.soldItems), productSalesError: reports.find((item) => item.productSalesError)?.productSalesError ?? null, productSalesMetric: reports.some((item) => item.productSalesMetric === "ordered_units") ? "ordered_units" : null, totals: Object.fromEntries(totalKeys.map((key) => [key, reports.reduce((sum, item) => sum + item.totals[key], 0)])) as typeof reports[number]["totals"],
      catalogCost: { matchedUnits: 0, unmatchedUnits: 0, costOfGoods: 0 },
    };
    const [catalogProducts, marketplaceProducts] = await Promise.all([
      db.select({ id: cogsProductsTable.id, sellerSku: cogsProductsTable.sellerSku, marketplace: cogsProductsTable.marketplace, unitCost: cogsProductsTable.unitCost }).from(cogsProductsTable).where(eq(cogsProductsTable.companyId, companyIdFromRequest(req))),
      db.select({ productId: cogsProductMarketplacesTable.productId, marketplaceSku: cogsProductMarketplacesTable.marketplaceSku, externalProductId: cogsProductMarketplacesTable.externalProductId }).from(cogsProductMarketplacesTable).where(and(eq(cogsProductMarketplacesTable.companyId, companyIdFromRequest(req)), eq(cogsProductMarketplacesTable.marketplace, "ozon"))),
    ]);
    const productsById = new Map(catalogProducts.map((product) => [product.id, product]));
    const bySellerSku = new Map<string, typeof catalogProducts[number]>();
    const byExternalId = new Map<string, typeof catalogProducts[number]>();
    for (const link of marketplaceProducts) {
      const product = productsById.get(link.productId);
      if (!product) continue;
      if (link.marketplaceSku) bySellerSku.set(link.marketplaceSku.trim().toLocaleLowerCase("ru-RU"), product);
      if (link.externalProductId) byExternalId.set(link.externalProductId.trim(), product);
    }
    for (const product of catalogProducts) if (product.marketplace === "both" || product.marketplace === "ozon") {
      const sku = product.sellerSku.trim().toLocaleLowerCase("ru-RU");
      if (sku && !bySellerSku.has(sku)) bySellerSku.set(sku, product);
    }
    let matchedUnits = 0; let unmatchedUnits = 0; let costOfGoods = 0;
    for (const item of report.soldItems) {
      const product = bySellerSku.get(item.sellerSku.trim().toLocaleLowerCase("ru-RU")) ?? byExternalId.get(item.externalProductId);
      if (!product) unmatchedUnits += item.quantity;
      else { matchedUnits += item.quantity; costOfGoods += Number(product.unitCost) * item.quantity; }
    }
    report.catalogCost = { matchedUnits, unmatchedUnits, costOfGoods: Math.round(costOfGoods * 100) / 100 };
    req.log.info({ marketplace: "ozon", accruals: report.totals.accrualsCount }, "Finance report loaded");
    res.json(report);
  } catch (error) {
    req.log.warn({ marketplace: "ozon" }, "Finance report request failed");
    if (error instanceof SyncDeferred) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((error.retryAt-Date.now())/1000))));
      res.status(503).json({ error: error.message, syncPending: true, nextAttemptAt: new Date(error.retryAt).toISOString() });
    } else res.status(502).json({ error: errorMessage(error) });
  }
});

router.get("/marketplace/finance/expenses", async (req, res): Promise<void> => {
  const ownerId = userIdFromRequest(req);
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
  if (!validDate(from) || !validDate(to) || from > to) { res.status(400).json({ error: "Укажите корректный период расходов." }); return; }
  const expenses = await db.select().from(sellerExpensesTable).where(and(
    eq(sellerExpensesTable.companyId, companyIdFromRequest(req)),
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
    ownerId, companyId: companyIdFromRequest(req), expenseDate, category, description, amount,
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
    eq(sellerExpensesTable.companyId, companyIdFromRequest(req)), eq(sellerExpensesTable.id, id),
  )).returning({ id: sellerExpensesTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Расход не найден." }); return; }
  res.status(204).end();
});

export default router;
