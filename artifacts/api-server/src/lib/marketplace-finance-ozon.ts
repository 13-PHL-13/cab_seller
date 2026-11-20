import { providerFetch, SyncDeferred, SyncRejected, syncContext } from './sync-context.ts';
type RecordValue = Record<string, unknown>;

export type OzonFinanceTotals = {
  accrued: number;
  posting: number;
  item: number;
  nonItem: number;
  containerFees: number;
  other: number;
  accrualsCount: number;
  missingAmountRows: number;
};

export type OzonFinanceResult = {
  marketplace: "ozon";
  currency: string | null;
  from: string;
  to: string;
  totals: OzonFinanceTotals;
  soldItems: Array<{ sellerSku: string; externalProductId: string; quantity: number }>;
  productSalesError: string | null;
  productSalesMetric: "ordered_units" | null;
};

function asRecord(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function amount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function extractSoldItems(rows: unknown[]) {
  const byIdentity = new Map<string, { sellerSku: string; externalProductId: string; quantity: number }>();
  for (const raw of rows) {
    const accrual = asRecord(raw);
    const posting = asRecord(accrual.posting);
    const products = asArray(accrual.products ?? accrual.items ?? accrual.product);
    for (const rawProduct of products) {
      const product = asRecord(rawProduct);
      const sellerSku = String(product.offer_id ?? product.offerId ?? product.seller_sku ?? product.sellerSku ?? "").trim();
      const externalProductId = String(product.sku ?? product.product_id ?? product.productId ?? "").trim();
      const quantity = Math.abs(amount(product.quantity ?? product.qty) ?? 0);
      if ((!sellerSku && !externalProductId) || quantity <= 0) continue;
      const postingNumber = String(posting.posting_number ?? posting.postingNumber ?? accrual.posting_number ?? "");
      const identity = `${postingNumber}\u0000${sellerSku.toLocaleLowerCase("ru-RU")}\u0000${externalProductId}`;
      const previous = byIdentity.get(identity);
      if (previous) previous.quantity = Math.max(previous.quantity, quantity);
      else byIdentity.set(identity, { sellerSku, externalProductId, quantity });
    }
  }
  return [...byIdentity.values()];
}

async function getOzonOrderedBySku(credentials: { clientId: string; apiKey: string }, from: string, to: string) {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 1000) {
  const response = await providerFetch("https://api-seller.ozon.ru/v1/analytics/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Client-Id": credentials.clientId, "Api-Key": credentials.apiKey },
    body: JSON.stringify({ date_from: from, date_to: to, dimension: ["sku"], metrics: ["ordered_units"], filters: [], limit: 1000, offset }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Ozon Analytics API вернул HTTP ${response.status} для отчёта по SKU.`);
  const payload = asRecord(await response.json());
  const page = asArray(asRecord(payload.result).data);
  rows.push(...page);
  if (page.length < 1000) break;
  }
  const quantities = new Map<string, number>();
  for (const raw of rows) {
    const row = asRecord(raw);
    const dimensions = asArray(row.dimensions);
    const sku = String(asRecord(dimensions[0]).id ?? "").trim();
    const metrics = asArray(row.metrics);
    const quantity = Math.max(0, amount(metrics[0]) ?? 0);
    if (sku && quantity > 0) quantities.set(sku, (quantities.get(sku) ?? 0) + quantity);
  }
  return [...quantities].map(([sku, quantity]) => ({ sellerSku: "", externalProductId: sku, quantity }));
}

export function aggregateOzonAccruals(rows: unknown[]): OzonFinanceTotals {
  const totals: OzonFinanceTotals = {
    accrued: 0,
    posting: 0,
    item: 0,
    nonItem: 0,
    containerFees: 0,
    other: 0,
    accrualsCount: rows.length,
    missingAmountRows: 0,
  };

  for (const raw of rows) {
    const accrual = asRecord(raw);
    const money = asRecord(accrual["total_amount"]);
    const value = amount(money["amount"]);
    if (value === null) {
      totals.missingAmountRows += 1;
      continue;
    }

    totals.accrued += value;
    const category = accrual["accrued_category"];
    if (category === "POSTING") totals.posting += value;
    else if (category === "ITEM") totals.item += value;
    else if (category === "NON_ITEM") totals.nonItem += value;
    else if (category === "CONTAINER_FEES") totals.containerFees += value;
    else totals.other += value;
  }

  totals.accrued = round(totals.accrued);
  totals.posting = round(totals.posting);
  totals.item = round(totals.item);
  totals.nonItem = round(totals.nonItem);
  totals.containerFees = round(totals.containerFees);
  totals.other = round(totals.other);
  return totals;
}

async function requestOzonAccrualDay(
  credentials: { clientId: string; apiKey: string },
  date: string,
  lastId: string,
): Promise<{ accruals: unknown[]; lastId: string }> {
  let response: Response;
  try {
    response = await providerFetch("https://api-seller.ozon.ru/v1/finance/accrual/by-day", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Id": credentials.clientId,
        "Api-Key": credentials.apiKey,
      },
      body: JSON.stringify({ date, last_id: lastId }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof SyncDeferred || error instanceof SyncRejected) throw error;
    throw new Error("Финансовый API Ozon не ответил. Повторите попытку позже.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Ozon отклонил запрос. Проверьте ключ и права доступа к финансовым начислениям.");
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    throw new Error(
      retryAfter
        ? `Ozon ограничил частоту запросов. Повторите попытку через ${retryAfter} сек.`
        : "Ozon ограничил частоту запросов. Повторите попытку позже.",
    );
  }
  if (!response.ok) {
    throw new Error(`Финансовый API Ozon вернул ошибку ${response.status}.`);
  }

  const payload = asRecord(await response.json());
  if (!Array.isArray(payload["accruals"])) {
    throw new Error("Ozon вернул неожиданный формат финансовых начислений.");
  }
  return {
    accruals: asArray(payload["accruals"]),
    lastId: typeof payload["last_id"] === "string" ? payload["last_id"] : "",
  };
}

function datesInRange(from: string, to: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export async function getOzonFinanceReport(
  credentials: { clientId: string; apiKey: string },
  from: string,
  to: string,
): Promise<OzonFinanceResult> {
  const rows: unknown[] = [];


  // Ozon explicitly requires sequential requests for its new accrual methods.
  for (const date of datesInRange(from, to)) {
    let lastId = "";
    const seenCursors = new Set<string>();
    for (;;) {
      const result = await requestOzonAccrualDay(credentials, date, lastId);
      rows.push(...result.accruals);
      if (!result.accruals.length || !result.lastId) break;
      if (seenCursors.has(result.lastId) || result.lastId === lastId) {
        throw new Error(`Ozon: курсор пагинации не изменился для даты ${date}. Отчёт не был завершён.`);
      }
      seenCursors.add(result.lastId);
      lastId = result.lastId;
    }
  }

  const currency = rows
    .map((row) => asRecord(asRecord(row)["total_amount"])["currency"])
    .find((value): value is string => typeof value === "string") ?? null;

  let soldItems = extractSoldItems(rows);
  let productSalesError: string | null = null;
  let productSalesMetric: "ordered_units" | null = null;
  if (!soldItems.length) {
    try { soldItems = await getOzonOrderedBySku(credentials, from, to); productSalesMetric = "ordered_units"; }
    catch (error) { productSalesError = error instanceof Error ? error.message : "Не удалось получить заказы Ozon по SKU."; }
  }

  return {
    marketplace: "ozon",
    currency,
    from,
    to,
    totals: aggregateOzonAccruals(rows),
    soldItems,
    productSalesError,
    productSalesMetric,
  };
}
