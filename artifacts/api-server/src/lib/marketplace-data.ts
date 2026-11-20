import { providerFetch, SyncDeferred, SyncRejected, syncContext } from './sync-context.ts';
import { createHash } from "node:crypto";
import type {OzonSubscription} from './ozon-subscription';
type OzonCredentials = { clientId: string; apiKey: string };
type WildberriesCredentials = { apiKey: string };

type DailyPoint = {
  date: string;
  revenue: number;
  orders: number;
  units: number;
  views: number;
  cartAdds: number;
  boughtUnits?: number | null;
  boughtAmount?: number | null;
  orderAmount?: number | null;
  missing?: Partial<Record<'revenue'|'orders'|'views'|'carts',boolean>>;
};

export type MarketplaceSnapshot = {
  subscription?:OzonSubscription;
  metricSchemaVersion?:number;
  wbDailyFunnel?: boolean;
  orderAmount?: number | null;
  daily: Map<string, DailyPoint>;
  funnel: Omit<DailyPoint, "date" | "revenue">;
  unavailable?: { sales?: string; funnel?: string; funnelDays?: string; views?: string; carts?: string; orders?: string; revenue?: string; buyouts?: string };
};

export class MarketplaceRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Превышен лимит запросов площадки. Повторите через ${retryAfterSeconds} сек.`);
    this.name = "MarketplaceRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
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

const wbEndpointCooldowns=new Map<string,number>();
async function requestJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const endpoint=new URL(url);
  const wbKey=endpoint.hostname.endsWith('.wildberries.ru') ? createHash('sha256').update(new Headers(init.headers).get('Authorization')??'').update(endpoint.origin+endpoint.pathname).digest('hex') : null;
  const retryAt=wbKey ? wbEndpointCooldowns.get(wbKey)??0 : 0;
  if(retryAt>Date.now())throw new MarketplaceRateLimitError(Math.ceil((retryAt-Date.now())/1000));
  let response: Response;
  try {
    response = await providerFetch(url, {
      ...init,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error instanceof SyncDeferred || error instanceof SyncRejected) throw error;
    throw new Error("Площадка не ответила. Попробуйте обновить данные позже.");
  }

  if (!response.ok) {
    const retryAfter = response.headers.get("X-Ratelimit-Retry") ??
      response.headers.get("Retry-After");
    if (response.status === 429) {
      const retrySeconds = Math.max(1, Math.ceil(Number(retryAfter) || 60));
      if(wbKey)wbEndpointCooldowns.set(wbKey,Date.now()+retrySeconds*1000);
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
  if (!Array.isArray(result["data"])) throw new Error("Ozon: не получен список строк аналитики.");
  return result["data"];
}

async function requestOzon(
  credentials: OzonCredentials,
  from: string,
  to: string,
  extended=true,
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
      metrics: extended ? ["revenue", "ordered_units", "session_view_pdp", "hits_tocart"] : ["revenue","ordered_units"],
      filters: [],
      limit: 1000,
      offset: 0,
    }),
  });
}

export async function verifyOzonCredentials(
  credentials: OzonCredentials,
): Promise<void> {
  // Credential checks must not spend the much smaller analytics budget.
  await requestJson('https://api-seller.ozon.ru/v1/roles', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Client-Id': credentials.clientId, 'Api-Key': credentials.apiKey },
    body: '{}',
  });
}

export async function getOzonSnapshot(
  credentials: OzonCredentials,
  from: string,
  to: string,
): Promise<MarketplaceSnapshot> {
  let response:Record<string,unknown>;
  try{response=await requestOzon(credentials,from,to);}
  catch(error){
    if(error instanceof SyncRejected && (error.status===403 || error.reason==='subscription'))response=await requestOzon(credentials,from,to,false);
    else throw error;
  }
  const snapshot = emptySnapshot();
  const rows=getOzonRows(response);
  snapshot.metricSchemaVersion=rows.length?2:undefined;
  if(!rows.length && asArray(asRecord(response.result).totals).length<4){
    snapshot.unavailable={views:'Просмотры Ozon не загружены: для расширенной аналитики требуется Premium Plus или Premium Pro.',carts:'Корзины Ozon не загружены: для расширенной аналитики требуется Premium Plus или Premium Pro.'};
  }
  for (const rawRow of rows) {
    const row = asRecord(rawRow);
    const dimensions = asArray(row["dimensions"]);
    const metrics = asArray(row["metrics"]);
    const dimension = asRecord(dimensions[0]);
    const date = dateKey(dimension["id"]);
    if (!date) continue;

    const fields=['revenue','orders','views','carts'] as const;
    const missing:NonNullable<DailyPoint['missing']>={};
    const labels=['сумма заказов','заказанные товары','просмотры','добавления в корзину'];
    fields.forEach((field,index)=>{
      const value=metrics[index];
      if(value===undefined || value===null || value==='' || !Number.isFinite(Number(value))) {
        snapshot.unavailable??={};
        missing[field]=true;
        snapshot.unavailable[field]=`Ozon не передал показатель «${labels[index]}»${index>=2 ? ': расширенная аналитика API требует Premium Plus или Premium Pro' : ''}.`;
      }
    });
    const point: DailyPoint = {
      missing,
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

export function projectOzonPeriod<T extends MarketplaceSnapshot>(snapshot:T,from:string,to:string):T {
  const result={...snapshot,daily:new Map([...snapshot.daily].filter(([date])=>date>=from&&date<=to)),unavailable:{...snapshot.unavailable}};
  if(snapshot.metricSchemaVersion===2){
    for(const field of ['revenue','orders','views','carts'] as const){
      const selected=[...result.daily.values()];
      const sourceMissingEverywhere=snapshot.daily.size>0 && [...snapshot.daily.values()].every(point=>point.missing?.[field]);
      if(!selected.some(point=>point.missing?.[field]) && (selected.length>0 || !sourceMissingEverywhere))delete result.unavailable[field];
    }
  }
  result.funnel=[...result.daily.values()].reduce((total,point)=>({orders:total.orders+point.orders,units:total.units+(point.boughtUnits??point.units),views:total.views+point.views,cartAdds:total.cartAdds+point.cartAdds}),{orders:0,units:0,views:0,cartAdds:0});
  return result;
}

async function requestWildberriesFunnel(
  credentials: WildberriesCredentials,
  from: string,
  to: string,
): Promise<Record<string, unknown>> {
  const cards: unknown[] = [];
  for (let offset = 0; ; offset += 1000) {
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
        offset,
      }),
    },
  );

  const page = wildberriesCards(response);
  cards.push(...page);
  if (page.length < 1000) break;
  }
  return { data: { cards } };
}

async function requestWildberriesSales(
  credentials: WildberriesCredentials,
  from: string,
): Promise<unknown[]> {
  // Both dashboard windows consume the same raw feed. Share that request;
  // supplier/sales has a much stricter quota than the analytics endpoint.
  const rollingStart = new Date(Date.now()-89*86400000).toISOString().slice(0,10);
  const sourceFrom = from < rollingStart ? from : rollingStart;
  const key=createHash('sha256').update(credentials.apiKey).update(sourceFrom).digest('hex');
  if (syncContext.getStore()) return loadWildberriesSales(credentials, sourceFrom);
  const cached=wbSalesCache.get(key);
  if(cached && cached.expiresAt>Date.now())return cached.rows;
  const pending=wbSalesRequests.get(key);
  if(pending)return pending;
  const request=loadWildberriesSales(credentials,sourceFrom).then(rows=>{
    wbSalesCache.set(key,{rows,expiresAt:Date.now()+65_000});
    return rows;
  }).finally(()=>wbSalesRequests.delete(key));
  wbSalesRequests.set(key,request);
  return request;
}
const wbSalesCache=new Map<string,{rows:unknown[];expiresAt:number}>();
const wbSalesRequests=new Map<string,Promise<unknown[]>>();
async function loadWildberriesSales(credentials: WildberriesCredentials,from:string):Promise<unknown[]> {
  const sales = new Map<string, unknown>();
  let cursor = from;
  for (;;) {
    const response = await requestJson(
      `https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(cursor)}&flag=0`,
      { method: "GET", headers: { Authorization: credentials.apiKey } },
    );
    const rows = asArray(response.data);
    for (const raw of rows) {
      const sale = asRecord(raw);
      if (typeof sale.saleID !== 'string') throw new Error('ВБ: в строке продажи отсутствует идентификатор.');
      sales.set(sale.saleID, raw);
    }
    if (rows.length < 80_000) break;
    const next = asRecord(rows[rows.length - 1]).lastChangeDate;
    if (typeof next !== 'string' || next <= cursor) throw new Error('ВБ: курсор продаж не продвинулся; выгрузка не завершена.');
    cursor = next;
  }
  return [...sales.values()];
}

function wildberriesCards(response: Record<string, unknown>): unknown[] {
  const data = asRecord(response["data"]);
  const cards = asArray(data["cards"] ?? data["products"]);
  if (cards.length > 0) return cards;
  if (!Array.isArray(response["data"]) && !Array.isArray(data["cards"]) && !Array.isArray(data["products"])) throw new Error("ВБ: не получен список товаров воронки.");
  return asArray(response["data"]);
}

function readWildberriesFunnel(
  response: Record<string, unknown>,
): MarketplaceSnapshot["funnel"] {
  const total = { orders: 0, units: 0, views: 0, cartAdds: 0, orderAmount: 0 as number|null };
  for (const rawCard of wildberriesCards(response)) {
    const card = asRecord(rawCard);
    const statistics = asRecord(card["statistic"] ?? card["statistics"]);
    const selected =
      asRecord(statistics["selectedPeriod"]).openCount !== undefined
        ? asRecord(statistics["selectedPeriod"])
        : asRecord(statistics["selected"]);
    const metrics =
      Object.keys(selected).length > 0
        ? selected
        : asRecord(card["selectedPeriod"]);
    if (['openCount','cartCount','orderCount','buyoutCount'].some(key => metrics[key] === undefined || metrics[key] === null || !Number.isFinite(Number(metrics[key])))) throw new Error('ВБ: в ответе statistic.selected отсутствуют обязательные показатели воронки.');
    total.views += asNumber(metrics["openCount"]);
    total.cartAdds += asNumber(metrics["cartCount"]);
    total.orders += asNumber(metrics["orderCount"]);
    total.units += asNumber(metrics["buyoutCount"]);
    const orderSum = metrics['orderSum'];
    total.orderAmount = total.orderAmount !== null && orderSum !== null && orderSum !== undefined && Number.isFinite(Number(orderSum)) ? total.orderAmount + Number(orderSum) : null;
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
  allowPartial = false,
): Promise<MarketplaceSnapshot> {
  const [funnelResult, salesResult] = await Promise.allSettled([
    requestWildberriesFunnel(credentials, from, to),
    requestWildberriesSales(credentials, from),
  ]);
  if(!allowPartial && (funnelResult.status==='rejected' || salesResult.status==='rejected'))throw funnelResult.status==='rejected' ? funnelResult.reason : salesResult.status==='rejected' ? salesResult.reason : new Error('Нет данных ВБ.');
  if(funnelResult.status==='rejected' && salesResult.status==='rejected')throw funnelResult.reason;
  const snapshot = emptySnapshot();
  snapshot.unavailable={};
  if(funnelResult.status==='fulfilled')snapshot.funnel=readWildberriesFunnel(funnelResult.value);
  else snapshot.unavailable.funnel=funnelResult.reason instanceof Error ? funnelResult.reason.message : 'Нет данных воронки ВБ.';
  if(salesResult.status==='rejected'){
    snapshot.unavailable.sales=salesResult.reason instanceof Error ? salesResult.reason.message : 'Нет данных продаж ВБ.';
  }
  snapshot.orderAmount=funnelResult.status==='fulfilled' ? snapshot.funnel.orderAmount : null;
  const sales=salesResult.status==='fulfilled' ? salesResult.value : [];
  // A successful complete feed establishes real zero-sale days, unlike a failed feed.
  for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=86400000){
    const date=new Date(t).toISOString().slice(0,10);
    snapshot.daily.set(date,{date,revenue:0,orders:0,units:0,views:0,cartAdds:0});
  }

  for (const rawSale of sales) {
    const sale = asRecord(rawSale);
    const date = dateKey(sale["date"]);
    if (!date || date < from || date > to || sale["isCancel"] === true) continue;
    // This endpoint returns one item per row; R-prefixed rows are returns.
    if(typeof sale['saleID']!=='string' || !sale['saleID'].startsWith('S'))continue;
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
    const quantity = 1;
    if (quantity <= 0 || price < 0) continue;
    point.revenue += price * quantity;
    point.orders += 1;
    point.units += quantity;
    snapshot.daily.set(date, point);
  }

  // Per-period totals cannot be spread over days or replaced with sales.
  // Read the same documented funnel method for each day; the durable worker
  // resumes from cached pages and obeys the ordinary Basic 30-minute budget.
  if (allowPartial) {
    snapshot.wbDailyFunnel=true;
    for (const point of snapshot.daily.values()) point.missing={views:true,carts:true,orders:true};
    for (const date of [...snapshot.daily.keys()].sort().reverse()) {
      try {
        const funnel=readWildberriesFunnel(await requestWildberriesFunnel(credentials,date,date));
        const point=snapshot.daily.get(date)!;
        point.views=funnel.views;point.cartAdds=funnel.cartAdds;point.orders=funnel.orders;
        point.orderAmount=funnel.orderAmount??null;point.missing={};
      } catch(error) {
        const reason=error instanceof Error?error.message:'Дневная воронка ВБ не загружена.';
        snapshot.unavailable.funnelDays??=reason;
        // A deferred request already records its retry time in syncContext.
        // Avoid probing every remaining day against the same unavailable budget.
        break;
      }
    }
  }
  return snapshot;
}

export function periodDates(period: "7d" | "30d" | "90d"): {
  from: string;
  to: string;
} {
  return dateRange(period);
}
