type OzonCredentials = { clientId: string; apiKey: string };
type WildberriesCredentials = { apiKey: string };

type DailyPoint = {
  date: string;
  revenue: number;
  orders: number;
  units: number;
  views: number;
  cartAdds: number;
};

export type MarketplaceSnapshot = {
  daily: Map<string, DailyPoint>;
  funnel: Omit<DailyPoint, "date" | "revenue">;
};

export class MarketplaceRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Превышен лимит запросов площадки. Повторите через ${retryAfterSeconds} сек.`);
    this.name = "MarketplaceRateLimitError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : 0;
}

function dateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function dateRange(period: "7d" | "30d" | "90d"): {
  from: string;
  to: string;
} {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (Number.parseInt(period, 10) - 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Площадка не ответила. Попробуйте обновить данные позже.");
  }

  if (!response.ok) {
    const retryAfter = response.headers.get("X-Ratelimit-Retry") ??
      response.headers.get("Retry-After");
    if (response.status === 429) {
      const retrySeconds = Math.max(1, Math.ceil(Number(retryAfter) || 60));
      throw new MarketplaceRateLimitError(retrySeconds);
    }
    const responseBody = (await response.text())
      .replace(/\s+/g, " ")
      .slice(0, 300);

    const message =
      response.status === 401 || response.status === 403
        ? "Площадка отклонила ключ или его права доступа."
        : `Площадка вернула ошибку ${response.status}.`;

    const details = [
      retryAfter ? `Повторить через: ${retryAfter}.` : "",
      responseBody ? `Подробности: ${responseBody}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    throw new Error(details ? `${message} ${details}` : message);
  }

  const payload: unknown = await response.json();
  if (Array.isArray(payload)) return { data: payload };
  const record = asRecord(payload);
  if (record["error"] || record["errors"]) {
    throw new Error("Площадка отклонила запрос. Проверьте права API-ключа.");
  }
  return record;
}

function emptySnapshot(): MarketplaceSnapshot {
  return {
    daily: new Map(),
    funnel: { orders: 0, units: 0, views: 0, cartAdds: 0 },
  };
}

function getOzonRows(response: Record<string, unknown>): unknown[] {
  const result = asRecord(response["result"]);
  return asArray(result["data"]);
}

async function requestOzon(
  credentials: OzonCredentials,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  return requestJson("https://api-seller.ozon.ru/v1/analytics/data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Id": credentials.clientId,
      "Api-Key": credentials.apiKey,
    },
    body: JSON.stringify({
      date_from: from,
      date_to: to,
      dimension: ["day"],
      metrics: ["revenue", "ordered_units", "session_view", "hits_tocart"],
      filters: [],
      limit: 1000,
      offset: 0,
    }),
  });
}

export async function verifyOzonCredentials(
  credentials: OzonCredentials,
): Promise<void> {
  const { from, to } = dateRange("7d");
  await requestOzon(credentials, from, to);
}

export async function getOzonSnapshot(
  credentials: OzonCredentials,
  from: string,
  to: string,
): Promise<MarketplaceSnapshot> {
  const response = await requestOzon(credentials, from, to);
  const snapshot = emptySnapshot();

  for (const rawRow of getOzonRows(response)) {
    const row = asRecord(rawRow);
    const dimensions = asArray(row["dimensions"]);
    const metrics = asArray(row["metrics"]);
    const dimension = asRecord(dimensions[0]);
    const date = dateKey(dimension["id"]);
    if (!date) continue;

    const point: DailyPoint = {
      date,
      revenue: asNumber(metrics[0]),
      // Ozon exposes ordered units, not an order count or confirmed buyouts.
      // The dashboard labels this stage explicitly as units.
      orders: asNumber(metrics[1]),
      units: 0,
      views: asNumber(metrics[2]),
      cartAdds: asNumber(metrics[3]),
    };
    snapshot.daily.set(date, point);
    snapshot.funnel.orders += point.orders;
    snapshot.funnel.units += point.units;
    snapshot.funnel.views += point.views;
    snapshot.funnel.cartAdds += point.cartAdds;
  }

  return snapshot;
}

async function requestWildberriesFunnel(
  credentials: WildberriesCredentials,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  const response = await requestJson(
    "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: credentials.apiKey,
      },
      body: JSON.stringify({
        selectedPeriod: { start: from, end: to },
        nmIds: [],
        skipDeletedNm: false,
        orderBy: { field: "openCard", mode: "desc" },
        limit: 1000,
        offset: 0,
      }),
    },
  );

  return { data: { cards: wildberriesCards(response) } };
}

async function requestWildberriesSales(
  credentials: WildberriesCredentials,
  from: string,
): Promise<unknown[]> {
  const response = await requestJson(
    `https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(from)}&flag=0`,
    {
      method: "GET",
      headers: { Authorization: credentials.apiKey },
    },
  );
  return Array.isArray(response["data"])
    ? asArray(response["data"])
    : asArray(response);
}

function wildberriesCards(response: Record<string, unknown>): unknown[] {
  const data = asRecord(response["data"]);
  const cards = asArray(data["cards"] ?? data["products"]);
  if (cards.length > 0) return cards;
  return asArray(response["data"]);
}

function readWildberriesFunnel(
  response: Record<string, unknown>,
): MarketplaceSnapshot["funnel"] {
  const total = { orders: 0, units: 0, views: 0, cartAdds: 0 };
  for (const rawCard of wildberriesCards(response)) {
    const card = asRecord(rawCard);
    const statistics = asRecord(card["statistics"]);
    const selected =
      asRecord(statistics["selectedPeriod"]).openCount !== undefined
        ? asRecord(statistics["selectedPeriod"])
        : asRecord(statistics["selected"]);
    const metrics =
      Object.keys(selected).length > 0
        ? selected
        : asRecord(card["selectedPeriod"]);
    total.views += asNumber(metrics["openCount"]);
    total.cartAdds += asNumber(metrics["cartCount"]);
    total.orders += asNumber(metrics["orderCount"]);
    total.units += asNumber(metrics["buyoutCount"]);
  }

  return total;
}

export async function verifyWildberriesCredentials(
  credentials: WildberriesCredentials,
): Promise<void> {
  await requestJson(
    "https://seller-analytics-api.wildberries.ru/ping",
    {
      method: "GET",
      headers: {
        Authorization: credentials.apiKey,
      },
    },
  );
}

export async function getWildberriesSnapshot(
  credentials: WildberriesCredentials,
  from: string,
  to: string,
): Promise<MarketplaceSnapshot> {
  const [funnelResponse, sales] = await Promise.all([
    requestWildberriesFunnel(credentials, from, to),
    requestWildberriesSales(credentials, from),
  ]);
  const snapshot = emptySnapshot();
  snapshot.funnel = readWildberriesFunnel(funnelResponse);

  for (const rawSale of sales) {
    const sale = asRecord(rawSale);
    const date = dateKey(sale["date"]);
    if (!date || date < from || date > to || sale["isCancel"] === true) continue;
    const point = snapshot.daily.get(date) ?? {
      date,
      revenue: 0,
      orders: 0,
      units: 0,
      views: 0,
      cartAdds: 0,
    };
    const price = asNumber(
      sale["finishedPrice"] ?? sale["priceWithDisc"] ?? sale["retailPrice"],
    );
    const quantity = asNumber(sale["quantity"]);
    if (quantity <= 0 || price < 0) continue;
    point.revenue += price * quantity;
    point.orders += 1;
    point.units += quantity;
    snapshot.daily.set(date, point);
  }

  return snapshot;
}

export function periodDates(period: "7d" | "30d" | "90d"): {
  from: string;
  to: string;
} {
  return dateRange(period);
}
