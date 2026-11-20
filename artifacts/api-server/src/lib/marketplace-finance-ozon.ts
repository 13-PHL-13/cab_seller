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
  dailyDashboard?:Array<{date:string; expenseBreakdown?: OzonExpenseBreakdown}&ReturnType<typeof ozonDashboardFinance>>;
  dashboardVersion?:number;
  dashboardDiagnostics?: ReturnType<typeof ozonAccrualShape>;
  dashboard?: {revenue:number|null;expenses:number|null;commission:number|null;logistics:number|null;other:number|null};
  expenseBreakdown?: OzonExpenseBreakdown;
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

const expenseLabels = {
  commission: "Вознаграждение Ozon",
  delivery: "Услуги доставки",
  partner: "Услуги партнёров",
  penalties: "Другие услуги и штрафы",
  adjustments: "Прочие начисления",
  ads: "Продвижение и реклама",
  fbo: "Услуги FBO",
} as const;
type ExpenseGroup = keyof typeof expenseLabels;
type AccrualType = { name: string; description: string };
type ExpenseItem = { label: string; amount: number };
type ExpenseArticle = ExpenseItem & { key: ExpenseGroup; details: ExpenseItem[] };
type OzonExpenseBreakdown = {
  complete: boolean;
  expenses: number | null;
  ads: number | null;
  fbo: number | null;
  articles: ExpenseArticle[];
  unclassified: ExpenseItem[];
};

function classifyAccrual(type: AccrualType | undefined): ExpenseGroup | undefined {
  if (!type) return undefined;
  const labels = [type.name, type.description].map(value => value.toLowerCase().replaceAll("ё", "е").trim());
  const rules: Array<[ExpenseGroup, RegExp]> = [
    ["ads", /^(продвижение и реклама|оплата за клик|оплата за заказ|оплата за показы|трафареты|вывод в топ|продвижение в поиске|медийная реклама|баллы за отзывы)(?:$|[.:])/u],
    ["fbo", /^(услуги fbo|размещение товаров на складе ozon|платное размещение|обработка поставки fbo)(?:$|[.:])/u],
    ["delivery", /^(услуги доставки|логистика|обратная логистика|доставка до места выдачи силами ozon)(?:$|[.:])/u],
    ["partner", /^(услуги партнеров|эквайринг|услуга эквайринга)(?:$|[.:])/u],
    ["penalties", /^(другие услуги и штрафы|штраф|штрафы)(?:$|[.:])/u],
    ["adjustments", /^прочие начисления(?:$|[.:])/u],
    ["commission", /^вознаграждение ozon(?:$|[.:])/u],
  ];
  return rules.find(([, pattern]) => labels.some(label => pattern.test(label)))?.[0];
}

/** Classify signed amounts without deriving financial categories from the residual. */
export function ozonExpenseBreakdown(rows: unknown[], types: ReadonlyMap<number, AccrualType>): OzonExpenseBreakdown {
  const groups = new Map<ExpenseGroup, Map<string, number>>();
  const unknown = new Map<string, number>();
  const currencies = new Set<string>();
  let incomplete = false;

  function cents(value: unknown) {
    const money = asRecord(value);
    if (typeof money.currency === "string" && money.currency) currencies.add(money.currency);
    const parsed = amount(money.amount);
    return parsed === null ? null : Math.round(parsed * 100);
  }

  function add(group: ExpenseGroup | undefined, label: string, value: number) {
    const bucket = group ? groups.get(group) ?? new Map<string, number>() : unknown;
    bucket.set(label, (bucket.get(label) ?? 0) + value);
    if (group) groups.set(group, bucket);
    else incomplete = true;
  }

  function service(raw: unknown, group?: ExpenseGroup) {
    const fee = asRecord(raw);
    const id = typeof fee.type_id === "number" ? fee.type_id : null;
    const type = id === null ? undefined : types.get(id);
    const label = [type?.description, type?.name].find(value => value && /[а-яё]/iu.test(value)) ??
      type?.name ?? (id === null ? "Начисление без типа" : `Тип начисления № ${id}`);
    const value = cents(fee.accrued);
    const category = group ?? classifyAccrual(type);
    return { label, value, category };
  }

  for (const raw of rows) {
    const row = asRecord(raw);
    const total = cents(row.total_amount);
    if (total === null) incomplete = true;
    let recorded = 0;
    if (row.accrued_category === "POSTING") {
      const products = asArray(asRecord(row.posting).products);
      if (!products.length) incomplete = true;
      for (const rawProduct of products) {
        const product = asRecord(rawProduct);
        const commission = asRecord(product.commission);
        if (Object.keys(commission).length) {
          const sale = cents(commission.sale_amount);
          const fee = cents(commission.commission);
          if (sale === null || fee === null) incomplete = true;
          recorded += (sale ?? 0) + (fee ?? 0);
          if (fee !== null) add("commission", "Комиссия за продажу", -fee);
        }
        const delivery = asRecord(product.delivery);
        if (!Object.keys(delivery).length) continue;
        const deliveryTotal = cents(delivery.total_accrued);
        if (deliveryTotal === null) { incomplete = true; continue; }
        recorded += deliveryTotal;
        const details = asArray(delivery.services).map(fee => service(fee, "delivery"));
        const detailsTotal = details.reduce((sum, fee) => sum + (fee.value ?? 0), 0);
        if (details.length && details.every(fee => fee.value !== null) && detailsTotal === deliveryTotal) {
          for (const fee of details) add("delivery", fee.label, -fee.value!);
        } else if (deliveryTotal !== 0 || details.length) {
          add("delivery", "Доставка без детализации", -deliveryTotal);
        }
      }
    } else {
      const fees = row.accrued_category === "NON_ITEM" ? [row.non_item_fee]
        : row.accrued_category === "ITEM" ? asArray(asRecord(row.item_fees).fees).flatMap(item => asArray(asRecord(item).fees))
        : row.accrued_category === "CONTAINER_FEES" ? asArray(asRecord(row.container_fees).fees) : [];
      for (const rawFee of fees) {
        const fee = service(rawFee);
        if (fee.value === null) { incomplete = true; continue; }
        recorded += fee.value;
        if (fee.value !== 0) add(fee.category, fee.label, -fee.value);
      }
    }
    if (total !== null && recorded !== total) add(undefined, "Начисления без детальной расшифровки", recorded - total);
  }

  const amountOf = (group: ExpenseGroup) => [...(groups.get(group)?.values() ?? [])].reduce((sum, value) => sum + value, 0);
  const toItems = (entries: Map<string, number>): ExpenseItem[] =>
    [...entries].map(([label, value]) => ({ label, amount: value / 100 }));
  const ordinary = (Object.keys(expenseLabels) as ExpenseGroup[]).filter(key => key !== "ads" && key !== "fbo");
  if (currencies.size > 1) return { complete: false, expenses: null, ads: null, fbo: null, articles: [], unclassified: [] };
  const hasOrdinary = ordinary.some(key => groups.has(key));
  return {
    complete: !incomplete,
    expenses: incomplete && !hasOrdinary ? null : ordinary.reduce((sum, key) => sum + amountOf(key), 0) / 100,
    ads: incomplete && !groups.has("ads") ? null : amountOf("ads") / 100,
    fbo: incomplete && !groups.has("fbo") ? null : amountOf("fbo") / 100,
    articles: ordinary.filter(key => groups.has(key)).map(key => ({
      key, label: expenseLabels[key], amount: amountOf(key) / 100, details: toItems(groups.get(key)!),
    })),
    unclassified: toItems(unknown),
  };
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

// total_amount is a net accrual, never gross revenue. Gross realized sales
// come only from posting.products[].commission.sale_amount (returns signed).
export function ozonDashboardFinance(rows:unknown[]) {
  let revenue=0,commission=0,logistics=0,complete=true,detailsComplete=true;
  const currencies=new Set<string>();
  for(const raw of rows){
    const row=asRecord(raw),money=asRecord(row.total_amount);
    if(typeof money.currency==='string')currencies.add(money.currency);
    if(amount(money.amount)===null)complete=false;
    if(row.accrued_category!=='POSTING')continue;
    const products=asArray(asRecord(row.posting).products);
    if(!products.length)complete=false;
    // Delivery-only accruals have no commission/sale object. They establish
    // zero realized sales only when their delivery sums reconcile to the
    // complete row amount; a missing sale field on a sale row stays unknown.
    const deliveryOnly=products.length>0&&products.every(rawProduct=>{
      const product=asRecord(rawProduct);return Object.keys(asRecord(product.commission)).length===0&&amount(asRecord(asRecord(product.delivery).total_accrued).amount)!==null;
    })&&round(products.reduce<number>((sum,rawProduct)=>sum+(amount(asRecord(asRecord(asRecord(rawProduct).delivery).total_accrued).amount)??0),0))===amount(money.amount);
    for(const rawProduct of products){
      const product=asRecord(rawProduct),fees=asRecord(product.commission);
      const sale=asRecord(fees.sale_amount),value=deliveryOnly?0:amount(sale.amount);
      if(typeof sale.currency==='string')currencies.add(sale.currency);
      if(value===null)complete=false;else revenue+=value;
      const fee=deliveryOnly?0:amount(asRecord(fees.commission).amount);
      const delivery=Object.keys(asRecord(product.delivery)).length===0?0:amount(asRecord(asRecord(product.delivery).total_accrued).amount);
      if(fee===null||delivery===null)detailsComplete=false;
      else {commission-=fee;logistics-=delivery;}
    }
  }
  if(currencies.size>1)complete=false;
  const expenses=complete?round(revenue-aggregateOzonAccruals(rows).accrued):null;
  return {revenue:complete?round(revenue):null,expenses,
    commission:complete&&detailsComplete?round(commission):null,
    logistics:complete&&detailsComplete?round(logistics):null,
    other:expenses!==null&&detailsComplete?round(expenses-commission-logistics):null};
}

// Counts only: diagnose schema coverage without exposing posting numbers,
// SKUs, company details or raw provider responses.
export function ozonAccrualShape(rows:unknown[]){
  let postingRows=0,emptyPostings=0,products=0,commissions=0,saleAmounts=0,scalarSaleAmounts=0,salePrices=0,deliveryAmounts=0;
  for(const raw of rows){const row=asRecord(raw);if(row.accrued_category!=='POSTING')continue;
    postingRows++;const items=asArray(asRecord(row.posting).products);if(!items.length)emptyPostings++;
    for(const rawProduct of items){products++;const product=asRecord(rawProduct),fee=asRecord(product.commission);
      if(Object.keys(fee).length)commissions++;
      if(amount(asRecord(fee.sale_amount).amount)!==null)saleAmounts++;
      if(amount(fee.sale_amount)!==null)scalarSaleAmounts++;
      if(amount(asRecord(fee.sale_price).amount)!==null)salePrices++;
      if(amount(asRecord(asRecord(product.delivery).total_accrued).amount)!==null)deliveryAmounts++;
    }
  }
  return {postingRows,emptyPostings,products,commissions,saleAmounts,scalarSaleAmounts,salePrices,deliveryAmounts};
}

export function ozonDailyDashboard(rows:unknown[],from:string,to:string,types?:ReadonlyMap<number,AccrualType>){
  // Do not silently lose undated or out-of-period accruals in a comparison.
  if(rows.some(raw=>{const date=asRecord(raw).date;return typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<from||date>to;}))return undefined;
  return datesInRange(from,to).map(date=>{
    const dailyRows = rows.filter(raw=>asRecord(raw).date===date);
    return { date, ...ozonDashboardFinance(dailyRows), ...(types && {expenseBreakdown: ozonExpenseBreakdown(dailyRows,types)}) };
  });
}

async function requestOzonAccrualTypes(credentials: { clientId: string; apiKey: string }) {
  try {
    const response = await providerFetch("https://api-seller.ozon.ru/v1/finance/accrual/types", {
      method: "POST",
      headers: { "Client-Id": credentials.clientId, "Api-Key": credentials.apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return undefined;
    const payload = asRecord(await response.json());
    const types = new Map<number, AccrualType>();
    for (const raw of asArray(payload.accrual_types)) {
      const type = asRecord(raw);
      if (typeof type.id === "number" && typeof type.name === "string") {
        types.set(type.id, { name: type.name, description: typeof type.description === "string" ? type.description : "" });
      }
    }
    return types.size ? types : undefined;
  } catch (error) {
    if (error instanceof SyncDeferred) throw error;
    // Ozon may reject access to the type dictionary while still providing raw totals.
    return undefined;
  }
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
  const types = await requestOzonAccrualTypes(credentials);

  // Ozon explicitly requires sequential requests for its new accrual methods.
  for (const date of datesInRange(from, to)) {
    let lastId = "";
    const seenCursors = new Set<string>();
    for (;;) {
      const result = await requestOzonAccrualDay(credentials, date, lastId);
      rows.push(...result.accruals.map(raw=>{
        const row=asRecord(raw),reportedDate=row.date;
        // Each page is requested for one known accrual day. Use that day if
        // an otherwise valid row omits it; preserve inconsistent dates so the
        // daily comparison fails closed rather than moving financial amounts.
        return {...row,date:reportedDate===undefined?date:typeof reportedDate==='string'&&reportedDate.slice(0,10)===date?date:reportedDate};
      }));
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
    dashboard:ozonDashboardFinance(rows),
    dailyDashboard:ozonDailyDashboard(rows,from,to,types),
    dashboardVersion:8,
    expenseBreakdown:types ? ozonExpenseBreakdown(rows,types) : undefined,
    dashboardDiagnostics:ozonAccrualShape(rows),
    currency,
    from,
    to,
    totals: aggregateOzonAccruals(rows),
    soldItems,
    productSalesError,
    productSalesMetric,
  };
}
