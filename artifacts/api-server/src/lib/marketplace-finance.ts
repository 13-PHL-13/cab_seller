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

const FIELDS = [
  "rrdId", "docTypeName", "currency", "retailAmount", "ppvzForPay",
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
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
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
  const rows = await financeRequest(
    "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed",
    apiKey,
    {
      dateFrom: `${from}T00:00:00`,
      dateTo: `${to}T23:59:59`,
      period: "daily",
      limit: 100000,
      rrdId: 0,
      fields: FIELDS,
    },
  );

  const currency = rows.map((row) => record(row)["currency"])
    .find((value): value is string => typeof value === "string") ?? null;

  return {
    marketplace: "wildberries",
    currency,
    from,
    to,
    rowsCount: rows.length,
    incomplete: rows.length >= 100000,
    totals: aggregateWildberriesFinance(rows),
  };
}
