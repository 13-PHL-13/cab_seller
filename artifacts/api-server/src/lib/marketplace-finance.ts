import { providerFetch, SyncDeferred, SyncRejected, syncContext } from './sync-context.ts';
export type WildberriesFinanceTotals = {
  retailAmount: number;
  sellerPayout: number;
  delivery: number;
  storage: number;
  acceptance: number;
  penalties: number;
  additionalPayments: number;
  deductions: number;
  acquiring: number;
  marketplaceReward: number;
};

export type WildberriesFinanceResult = {
  marketplace: "wildberries";
  currency: string | null;
  from: string;
  to: string;
  rowsCount: number;
  incomplete: boolean;
  totals: WildberriesFinanceTotals;
  soldItems: Array<{ sellerSku: string; externalProductId: string; quantity: number }>;
  catalogCost?: { matchedUnits: number; unmatchedUnits: number; costOfGoods: number };
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function amount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function textField(row: UnknownRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}

const FIELDS = [
  "rrdId", "docTypeName", "currency", "retailAmount", "ppvzForPay", "saName", "nmId", "quantity",
  "deliveryRub", "storageFee", "acceptance", "penalty",
  "additionalPayment", "deduction", "acquiringFee", "ppvzReward",
];

export function aggregateWildberriesFinance(rows: unknown[]): WildberriesFinanceTotals {
  const totals: WildberriesFinanceTotals = {
    retailAmount: 0,
    sellerPayout: 0,
    delivery: 0,
    storage: 0,
    acceptance: 0,
    penalties: 0,
    additionalPayments: 0,
    deductions: 0,
    acquiring: 0,
    marketplaceReward: 0,
  };

  for (const raw of rows) {
    const row = record(raw);
    totals.retailAmount += amount(row["retailAmount"]);
    totals.sellerPayout += amount(row["ppvzForPay"]);
    totals.delivery += amount(row["deliveryRub"]);
    totals.storage += amount(row["storageFee"]);
    totals.acceptance += amount(row["acceptance"]);
    totals.penalties += amount(row["penalty"]);
    totals.additionalPayments += amount(row["additionalPayment"]);
    totals.deductions += amount(row["deduction"]);
    totals.acquiring += amount(row["acquiringFee"]);
    totals.marketplaceReward += amount(row["ppvzReward"]);
  }

  for (const key of Object.keys(totals) as Array<keyof WildberriesFinanceTotals>) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }
  return totals;
}

async function financeRequest(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<unknown[]> {
  let response: Response;
  try {
    response = await providerFetch(url, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof SyncDeferred || error instanceof SyncRejected) throw error;
    throw new Error("Финансовый API Wildberries не ответил. Повторите попытку позже.");
  }

  if (response.status === 204) return [];
  if (response.status === 401 || response.status === 403) {
    throw new Error("Wildberries отклонил запрос. Проверьте наличие прав категории «Финансы» у API-ключа.");
  }
  if (response.status === 429) {
    throw new Error("Wildberries ограничил частоту финансовых запросов. Подождите не менее минуты перед повторной загрузкой.");
  }
  if (!response.ok) {
    throw new Error(`Финансовый API Wildberries вернул ошибку ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Wildberries вернул неожиданный формат финансового отчёта.");
  }
  return payload;
}

export async function getWildberriesFinanceReport(
  apiKey: string,
  from: string,
  to: string,
): Promise<WildberriesFinanceResult> {
  const byId = new Map<string, unknown>();
  let rrdId = 0;
  for (;;) {
    const page = await financeRequest(
      "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed", apiKey,
      { dateFrom: `${from}T00:00:00`, dateTo: `${to}T23:59:59`, period: "daily", limit: 100000, rrdId, fields: FIELDS },
    );
    for (let i=0; i<page.length; i++) {
      const id = record(page[i]).rrdId;
      byId.set(id === undefined ? `single:${i}` : String(id), page[i]);
    }
    if (page.length < 100000) break;
    const next = Number(record(page[page.length-1]).rrdId);
    if (!Number.isSafeInteger(next) || next <= rrdId) throw new Error('ВБ: курсор финансового отчёта не продвинулся.');
    rrdId = next;
  }
  const rows = [...byId.values()];
  const currencies = new Set(rows.map(row => record(row).currency).filter(Boolean));
  if (currencies.size > 1) throw new Error('ВБ: отчёт содержит разные валюты; складывать суммы нельзя.');

  const currency = rows.map((row) => record(row)["currency"])
    .find((value): value is string => typeof value === "string") ?? null;

  const soldItemsByIdentity = new Map<string, { sellerSku: string; externalProductId: string; quantity: number }>();
  for (const raw of rows) {
    const row = record(raw);
    const docType = textField(row, "docTypeName", "doc_type_name").toLocaleLowerCase("ru-RU");
    if (!docType.includes("продаж") && !docType.includes("возврат")) continue;
    const sellerSku = textField(row, "saName", "sa_name", "supplierArticle");
    const externalProductId = textField(row, "nmId", "nm_id", "nmID");
    if (!sellerSku && !externalProductId) continue;
    const qty = Math.abs(amount(row["quantity"]));
    if (!qty) continue;
    const signedQuantity = docType.includes("возврат") ? -qty : qty;
    const identity = `${sellerSku.toLocaleLowerCase("ru-RU")}\u0000${externalProductId}`;
    const previous = soldItemsByIdentity.get(identity);
    if (previous) previous.quantity += signedQuantity;
    else soldItemsByIdentity.set(identity, { sellerSku, externalProductId, quantity: signedQuantity });
  }

  return {
    marketplace: "wildberries",
    currency,
    from,
    to,
    rowsCount: rows.length,
    incomplete: false,
    totals: aggregateWildberriesFinance(rows),
    soldItems: [...soldItemsByIdentity.values()].filter((item) => item.quantity !== 0),
  };
}
