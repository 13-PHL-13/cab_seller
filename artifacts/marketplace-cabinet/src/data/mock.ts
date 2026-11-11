/**
 * Слой данных кабинета.
 *
 * Сейчас данные генерируются детерминированным генератором (демо-режим).
 * При подключении реальных API (Ozon Seller API, WB API) функции ниже
 * заменяются на загрузку с сервера — структуры данных сохраняются.
 */

export type PlatformId = 'ozon' | 'wb';

export interface PlatformInfo {
  id: PlatformId;
  name: string;
  color: string;
  initial: string;
  docsUrl: string;
}

export const PLATFORMS: PlatformInfo[] = [
  { id: 'ozon', name: 'Ozon', color: '#005BFF', initial: 'O', docsUrl: 'https://docs.ozon.ru/api/seller' },
  { id: 'wb', name: 'Wildberries', color: '#A73AFD', initial: 'W', docsUrl: 'https://dev.wildberries.ru' },
];

export function platformById(id: string): PlatformInfo | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

export interface DayPoint {
  date: string; // ISO yyyy-mm-dd
  revenue: number; // заказано, ₽
  revenueBought: number; // выкуплено (фактические продажи), ₽
  orders: number; // заказов
  units: number; // заказано, шт
  views: number; // просмотры карточек
  visits: number; // перешли в карточку
  cart: number; // добавили в корзину
  bought: number; // выкуплено, шт
}

export type DayField = 'revenue' | 'revenueBought' | 'orders' | 'units' | 'views' | 'visits' | 'cart' | 'bought';

/* ------------------------------ Генератор ------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS_TOTAL = 120;

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface PlatformParams {
  seed: number;
  baseRevenue: number;
  avgCheck: number;
  visitsPerOrder: number;
  cartRate: number;
  buyoutRate: number;
}

const PARAMS: Record<PlatformId, PlatformParams> = {
  ozon: { seed: 20260101, baseRevenue: 92000, avgCheck: 2280, visitsPerOrder: 27, cartRate: 0.072, buyoutRate: 0.93 },
  wb: { seed: 777123, baseRevenue: 118000, avgCheck: 1690, visitsPerOrder: 31, cartRate: 0.064, buyoutRate: 0.9 },
};

function weekdayFactor(dow: number): number {
  // 0 = вс … 6 = сб
  return [1.12, 0.93, 0.9, 0.94, 0.98, 1.08, 1.17][dow];
}

function generateDays(pid: PlatformId, params: PlatformParams): DayPoint[] {
  const rnd = mulberry32(params.seed);
  const days: DayPoint[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  // Фазы волн у площадок сдвинуты, чтобы кривые стадий не накладывались.
  const buyoutPhase = pid === 'ozon' ? 2.1 : 0;

  for (let i = 0; i < DAYS_TOTAL; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - (DAYS_TOTAL - 1 - i));

    const trend = 1 + i * 0.0016; // плавный рост ~19% за период
    const wave = 1 + 0.09 * Math.sin(i / 7.5);
    const noise = 0.86 + rnd() * 0.28;
    const revenue = params.baseRevenue * trend * wave * weekdayFactor(date.getDay()) * noise;
    const orders = revenue / params.avgCheck;
    const units = orders * (1.05 + rnd() * 0.22);

    // Воронка: у Wildberries статистика переходов (карточка, корзина) приходит из API.
    // У Ozon таких метрик в API нет — синтезируем её исходя из данных, которыми
    // пользуется WB: visitsPerOrder и cartRate берём из коэффициентов конверсии WB
    // и применяем к заказам Ozon с собственной вариацией площадки.
    const ozonDrift = pid === 'wb' ? 1 : 0.88 + rnd() * 0.24;
    const visits = orders * params.visitsPerOrder * ozonDrift * (0.92 + rnd() * 0.16);
    const cart = visits * params.cartRate * (pid === 'wb' ? 1 : 0.8 + rnd() * 0.4) * (0.85 + rnd() * 0.3);

    // Выкуп колеблется вокруг базового уровня своей волной — линии «Заказали»
    // и «Выкупили» расходятся, а не сливаются в одну.
    const buyout = params.buyoutRate + 0.05 * Math.sin(i / 4.2 + buyoutPhase) + (rnd() - 0.5) * 0.06;
    const bought = units * buyout;

    days.push({
      date: isoDate(date),
      revenue,
      revenueBought: revenue * buyout,
      orders,
      units,
      views: visits * (1.35 + rnd() * 0.55),
      visits,
      cart,
      bought,
    });
  }
  return days;
}

const DATA: Record<PlatformId, DayPoint[]> = {
  ozon: generateDays('ozon', PARAMS.ozon),
  wb: generateDays('wb', PARAMS.wb),
};

/* ------------------------------ Выборки ------------------------------ */

export function daysFor(platform: PlatformId): DayPoint[] {
  return DATA[platform];
}

export function sliceLast(days: DayPoint[], count: number): DayPoint[] {
  return days.slice(-count);
}

export function sumField(days: DayPoint[], field: DayField): number {
  return days.reduce((acc, d) => acc + d[field], 0);
}

function changePct(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

export interface Kpi {
  value: number;
  change: number; // % к предыдущему периоду
}

export interface PeriodKpis {
  revenue: Kpi;
  orders: Kpi;
  views: Kpi;
  avgCheck: Kpi;
  boughtRevenue: Kpi;
}

/** KPI по набору площадок за последние `periodDays` дней против предыдущего периода. */
export function periodKpis(platforms: PlatformId[], periodDays: number): PeriodKpis {
  const total = DAYS_TOTAL;
  const curStart = Math.max(0, total - periodDays);
  const prevStart = Math.max(0, total - periodDays * 2);
  const curDays = platforms.map((p) => DATA[p].slice(curStart));
  const prevDays = platforms.map((p) => DATA[p].slice(prevStart, curStart));

  const sum = (arr: DayPoint[][], field: DayField) =>
    arr.reduce((acc, days) => acc + sumField(days, field), 0);

  const revenue = sum(curDays, 'revenue');
  const prevRevenue = sum(prevDays, 'revenue');
  const orders = sum(curDays, 'orders');
  const prevOrders = sum(prevDays, 'orders');
  const views = sum(curDays, 'views');
  const prevViews = sum(prevDays, 'views');
  const boughtRevenue = sum(curDays, 'revenueBought');
  const prevBoughtRevenue = sum(prevDays, 'revenueBought');

  return {
    revenue: { value: revenue, change: changePct(revenue, prevRevenue) },
    orders: { value: orders, change: changePct(orders, prevOrders) },
    views: { value: views, change: changePct(views, prevViews) },
    avgCheck: {
      value: orders > 0 ? revenue / orders : 0,
      change: changePct(orders > 0 ? revenue / orders : 0, prevOrders > 0 ? prevRevenue / prevOrders : 0),
    },
    boughtRevenue: { value: boughtRevenue, change: changePct(boughtRevenue, prevBoughtRevenue) },
  };
}

/** Ряд выручки по дням для выбранных площадок (для линейных/area-графиков). */
export function revenueSeries(
  platforms: PlatformId[],
  periodDays: number,
): Array<Record<string, number | string>> {
  const baseDays = DATA[PLATFORMS[0].id];
  const days = baseDays.slice(-periodDays);
  return days.map((d, i) => {
    const row: Record<string, number | string> = {
      date: d.date,
      label: d.date.slice(8) + '.' + d.date.slice(5, 7),
    };
    for (const p of platforms) {
      const dp = DATA[p][DATA[p].length - periodDays + i];
      row[p] = Math.round(dp.revenue);
      row[`${p}Bought`] = Math.round(dp.revenueBought);
    }
    return row;
  });
}

/** Ряд проданных единиц по дням (фактические продажи, шт). */
export function unitsSeries(
  platforms: PlatformId[],
  periodDays: number,
): Array<Record<string, number | string>> {
  const baseDays = DATA[PLATFORMS[0].id];
  const days = baseDays.slice(-periodDays);
  return days.map((d, i) => {
    const row: Record<string, number | string> = {
      date: d.date,
      label: d.date.slice(8) + '.' + d.date.slice(5, 7),
    };
    let total = 0;
    for (const p of platforms) {
      const v = Math.round(DATA[p][DATA[p].length - periodDays + i].bought);
      row[p] = v;
      total += v;
    }
    row.total = total;
    return row;
  });
}

/** Заказы и возвраты за последние 7 дней (для bar-чарта на дашборде). */
export function weekdayOrders(platforms: PlatformId[]): Array<{ day: string; orders: number; returns: number }> {
  const names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const baseDays = DATA[PLATFORMS[0].id];
  const days = baseDays.slice(-7);
  return days.map((d, i) => {
    let orders = 0;
    for (const p of platforms) orders += DATA[p][DATA[p].length - 7 + i].orders;
    const dow = new Date(d.date + 'T12:00:00').getDay();
    return {
      day: names[dow],
      orders: Math.round(orders),
      returns: Math.round(orders * 0.055),
    };
  });
}

/* ------------------------------ Воронка ------------------------------ */

export type FunnelUnit = 'units' | 'rub';

export interface FunnelPlatformValues {
  visits: number;
  cart: number;
  ordered: number;
  bought: number;
}

export interface FunnelPoint {
  label: string;
  visits: number;
  cart: number;
  ordered: number;
  bought: number;
  /** Разбивка точки по магазинам (для подсказок при наведении). */
  byPlatform?: Record<string, FunnelPlatformValues>;
}

export interface FunnelStage {
  key: 'visits' | 'cart' | 'ordered' | 'bought';
  name: string;
  color: string;
  value: number;
  change: number;
  note: string;
}

type StageKey = 'visits' | 'cart' | 'ordered' | 'bought';

/**
 * Стадии воронки: визиты → корзина → заказано → выкуплено.
 * В режиме «рубли» каждая стадия переводится в деньги через среднюю цену
 * единицы товара (визит и корзина — с условной ценностью перехода).
 */
function stageValue(d: DayPoint, key: StageKey, unit: FunnelUnit): number {
  const unitsValue =
    key === 'visits' ? d.visits : key === 'cart' ? d.cart : key === 'ordered' ? d.units : d.bought;
  if (unit === 'units') return unitsValue;
  const price = d.revenue / d.units; // ₽ за штуку
  switch (key) {
    case 'visits':
      return d.visits * price * 0.06;
    case 'cart':
      return d.cart * price * 0.55;
    case 'ordered':
      return d.revenue;
    case 'bought':
      return d.revenueBought;
  }
}

function sumStage(platforms: PlatformId[], from: number, to: number, key: StageKey, unit: FunnelUnit): number {
  let total = 0;
  for (const p of platforms) {
    const days = DATA[p].slice(from, to);
    for (const d of days) total += stageValue(d, key, unit);
  }
  return total;
}

/** Итоги воронки за период + изменения к предыдущему периоду. */
export function funnelStages(platforms: PlatformId[], periodDays: number, unit: FunnelUnit): FunnelStage[] {
  const total = DAYS_TOTAL;
  const curStart = Math.max(0, total - periodDays);
  const prevStart = Math.max(0, total - periodDays * 2);

  const totals = {
    visits: sumStage(platforms, curStart, total, 'visits', unit),
    cart: sumStage(platforms, curStart, total, 'cart', unit),
    ordered: sumStage(platforms, curStart, total, 'ordered', unit),
    bought: sumStage(platforms, curStart, total, 'bought', unit),
  };
  const prev = {
    visits: sumStage(platforms, prevStart, curStart, 'visits', unit),
    cart: sumStage(platforms, prevStart, curStart, 'cart', unit),
    ordered: sumStage(platforms, prevStart, curStart, 'ordered', unit),
    bought: sumStage(platforms, prevStart, curStart, 'bought', unit),
  };

  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);
  const isRub = unit === 'rub';

  return [
    { key: 'visits', name: 'Перешли в карточку', color: '#e6448c', value: Math.round(totals.visits), change: changePct(totals.visits, prev.visits), note: '' },
    { key: 'cart', name: 'Добавили в корзину', color: '#7c3aed', value: Math.round(totals.cart), change: changePct(totals.cart, prev.cart), note: isRub ? '' : `${pct(totals.cart, totals.visits).toFixed(0)}% добавили в корзину` },
    { key: 'ordered', name: 'Заказали', color: '#14b8a6', value: Math.round(totals.ordered), change: changePct(totals.ordered, prev.ordered), note: isRub ? '' : `${pct(totals.ordered, totals.visits).toFixed(0)}% заказали товаров` },
    { key: 'bought', name: 'Выкупили', color: '#3b82f6', value: Math.round(totals.bought), change: changePct(totals.bought, prev.bought), note: isRub ? '' : `${pct(totals.bought, totals.ordered).toFixed(0)}% процент выкупа` },
  ];
}

/** Временной ряд воронки для графика (по дням или неделям) с разбивкой по магазинам. */
export function funnelSeries(
  platforms: PlatformId[],
  periodDays: number,
  unit: FunnelUnit,
  granularity: 'day' | 'week',
): FunnelPoint[] {
  const total = DAYS_TOTAL;
  const curStart = Math.max(0, total - periodDays);
  const baseDays = DATA[PLATFORMS[0].id];
  const days = baseDays.slice(curStart);

  const points: FunnelPoint[] = days.map((d, i) => {
    const point: FunnelPoint = { label: d.date.slice(8) + '.' + d.date.slice(5, 7), visits: 0, cart: 0, ordered: 0, bought: 0, byPlatform: {} };
    for (const p of platforms) {
      const dp = DATA[p][curStart + i];
      const values: FunnelPlatformValues = { visits: 0, cart: 0, ordered: 0, bought: 0 };
      for (const key of ['visits', 'cart', 'ordered', 'bought'] as StageKey[]) {
        const v = stageValue(dp, key, unit);
        point[key] += v;
        values[key] = v;
      }
      point.byPlatform![p] = values;
    }
    return point;
  });

  if (granularity === 'day') return points;
  const out: FunnelPoint[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const chunk = points.slice(i, i + 7);
    const agg: FunnelPoint = {
      label: chunk[0].label,
      visits: chunk.reduce((a, p) => a + p.visits, 0),
      cart: chunk.reduce((a, p) => a + p.cart, 0),
      ordered: chunk.reduce((a, p) => a + p.ordered, 0),
      bought: chunk.reduce((a, p) => a + p.bought, 0),
      byPlatform: {},
    };
    for (const p of platforms) {
      agg.byPlatform![p] = {
        visits: chunk.reduce((a, pt) => a + (pt.byPlatform?.[p]?.visits ?? 0), 0),
        cart: chunk.reduce((a, pt) => a + (pt.byPlatform?.[p]?.cart ?? 0), 0),
        ordered: chunk.reduce((a, pt) => a + (pt.byPlatform?.[p]?.ordered ?? 0), 0),
        bought: chunk.reduce((a, pt) => a + (pt.byPlatform?.[p]?.bought ?? 0), 0),
      };
    }
    out.push(agg);
  }
  return out;
}

/** Итоги воронки по каждому магазину отдельно (для легенды стадий). */
export function funnelStagesByPlatform(
  platforms: PlatformId[],
  periodDays: number,
  unit: FunnelUnit,
): Record<string, FunnelStage[]> {
  return Object.fromEntries(platforms.map((p) => [p, funnelStages([p], periodDays, unit)]));
}

/** Домен логарифмической шкалы: все стадии воронки видимы на одном графике. */
export function logDomain(values: number[]): [number, number] {
  const positive = values.filter((v) => v > 0);
  const min = positive.length > 0 ? Math.min(...positive) : 1;
  const max = positive.length > 0 ? Math.max(...positive) : 10;
  return [Math.max(1, min * 0.6), max * 1.15];
}

/** «Круглые» деления (1, 2, 5 × 10ⁿ) для логарифмической шкалы. */
export function logTicks(domain: [number, number]): number[] {
  const ticks: number[] = [];
  const start = Math.floor(Math.log10(domain[0]));
  const end = Math.ceil(Math.log10(domain[1]));
  for (let e = start; e <= end; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= domain[0] && v <= domain[1]) ticks.push(v);
    }
  }
  return ticks.length > 1 ? ticks : [domain[0], domain[1]];
}

/* ------------------------------ Товары ------------------------------ */

export interface Product {
  id: string;
  name: string;
  sku: string;
  platform: PlatformId;
  category: string;
  price: number;
  orders: number;
  revenue: number;
  rating: number;
  stock: number;
}

export const PRODUCTS: Product[] = [
  { id: 'p1', name: 'Чехол для гладильной доски универсальный', sku: 'CH-4821', platform: 'ozon', category: 'Дом', price: 890, orders: 1420, revenue: 1263800, rating: 4.8, stock: 340 },
  { id: 'p2', name: 'Рюкзак городской водостойкий 22 л', sku: 'BK-1120', platform: 'wb', category: 'Аксессуары', price: 2490, orders: 980, revenue: 2440200, rating: 4.7, stock: 128 },
  { id: 'p3', name: 'Набор контейнеров для еды 8 предметов', sku: 'CT-3305', platform: 'wb', category: 'Кухня', price: 1290, orders: 870, revenue: 1122300, rating: 4.6, stock: 512 },
  { id: 'p4', name: 'Кроссовки Nike Air Max', sku: 'SN-9012', platform: 'ozon', category: 'Обувь', price: 8990, orders: 412, revenue: 3703880, rating: 4.9, stock: 64 },
  { id: 'p5', name: 'Рожок городской', sku: 'RZ-2087', platform: 'wb', category: 'Дом', price: 3450, orders: 386, revenue: 1331700, rating: 4.5, stock: 89 },
  { id: 'p6', name: 'Термокружка стальная 500 мл', sku: 'TM-7743', platform: 'ozon', category: 'Кухня', price: 1190, orders: 745, revenue: 886550, rating: 4.7, stock: 230 },
  { id: 'p7', name: 'Органайзер для косметики акриловый', sku: 'OG-5518', platform: 'wb', category: 'Красота', price: 790, orders: 1120, revenue: 884800, rating: 4.4, stock: 410 },
  { id: 'p8', name: 'Свеча ароматическая соевая', sku: 'SW-2210', platform: 'ozon', category: 'Дом', price: 640, orders: 930, revenue: 595200, rating: 4.8, stock: 720 },
  { id: 'p9', name: 'Поводок для собак рулетка 5 м', sku: 'PT-6634', platform: 'wb', category: 'Зоотовары', price: 990, orders: 610, revenue: 603900, rating: 4.6, stock: 155 },
  { id: 'p10', name: 'Лампа настольная светодиодная', sku: 'LP-4421', platform: 'ozon', category: 'Освещение', price: 1890, orders: 355, revenue: 670950, rating: 4.5, stock: 47 },
];

/* ------------------------------ Заказы ------------------------------ */

export type OrderStatus = 'Доставлен' | 'В пути' | 'Собирается' | 'Отменён';

export interface Order {
  id: string;
  platform: PlatformId;
  product: string;
  sum: number;
  status: OrderStatus;
  date: string;
  customer: string;
}

function generateOrders(): Order[] {
  const statuses: OrderStatus[] = ['Доставлен', 'В пути', 'Собирается', 'Доставлен', 'Отменён', 'Доставлен'];
  const customers = ['Иванова А.', 'Петров С.', 'Смирнова К.', 'Кузнецов Д.', 'Попова Е.', 'Васильев М.', 'Николаева О.', 'Фёдоров И.'];
  const rnd = mulberry32(424242);
  const orders: Order[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 0; i < 12; i++) {
    const product = PRODUCTS[Math.floor(rnd() * PRODUCTS.length)];
    const date = new Date(today);
    date.setDate(today.getDate() - Math.floor(rnd() * 3));
    date.setHours(9 + Math.floor(rnd() * 12), Math.floor(rnd() * 60));
    orders.push({
      id: `${product.platform === 'ozon' ? 'OZ' : 'WB'}-${2847 - i * 137}`,
      platform: product.platform,
      product: product.name,
      sum: product.price * (1 + Math.floor(rnd() * 2)),
      status: statuses[Math.floor(rnd() * statuses.length)],
      date: date.toISOString(),
      customer: customers[Math.floor(rnd() * customers.length)],
    });
  }
  return orders;
}

export const RECENT_ORDERS: Order[] = generateOrders();

/* ------------------------------ География ------------------------------ */

export interface GeoRow {
  region: string;
  share: number; // доля, %
}

export const GEOGRAPHY: Record<PlatformId, GeoRow[]> = {
  ozon: [
    { region: 'Московский', share: 24.3 },
    { region: 'Санкт-Петербург и ЛО', share: 11.8 },
    { region: 'Приволжский', share: 14.6 },
    { region: 'Уральский', share: 10.2 },
    { region: 'Сибирский', share: 13.1 },
    { region: 'Южный', share: 9.4 },
    { region: 'Дальневосточный', share: 6.3 },
    { region: 'Казахстан', share: 4.1 },
  ],
  wb: [
    { region: 'Московский', share: 20.7 },
    { region: 'Дальневосточный и Сибирский', share: 16.7 },
    { region: 'Приволжский', share: 15.2 },
    { region: 'Санкт-Петербург и ЛО', share: 12.5 },
    { region: 'Уральский', share: 10.8 },
    { region: 'Южный', share: 9.6 },
    { region: 'Северо-Кавказский', share: 5.9 },
    { region: 'Казахстан', share: 3.4 },
  ],
};

/* ------------------------------ Финансы ------------------------------ */

export interface Balance {
  platform: PlatformId;
  current: number; // текущий баланс
  pending: number; // к удержанию
  nextPayoutDays: number; // через сколько дней выплата
  nextPayout: number;
  lastPayout: number;
  lastPayoutDate: string;
}

export const BALANCES: Balance[] = [
  { platform: 'ozon', current: 442120, pending: 18340, nextPayoutDays: 2, nextPayout: 251310, lastPayout: 198450, lastPayoutDate: '2026-11-07' },
  { platform: 'wb', current: 616640, pending: 9270, nextPayoutDays: 1, nextPayout: 384200, lastPayout: 274930, lastPayoutDate: '2026-11-08' },
];

export type TxType = 'Продажа' | 'Комиссия' | 'Логистика' | 'Выплата' | 'Реклама' | 'Возврат';

export interface Transaction {
  id: string;
  date: string;
  type: TxType;
  platform: PlatformId;
  amount: number; // со знаком: приход +, расход −
}

export const TRANSACTIONS: Transaction[] = [
  { id: 'TX-9021', date: '2026-11-10', type: 'Продажа', platform: 'ozon', amount: 8990 },
  { id: 'TX-9020', date: '2026-11-10', type: 'Продажа', platform: 'wb', amount: 12450 },
  { id: 'TX-9019', date: '2026-11-10', type: 'Комиссия', platform: 'ozon', amount: -1987 },
  { id: 'TX-9018', date: '2026-11-09', type: 'Выплата', platform: 'wb', amount: 274930 },
  { id: 'TX-9017', date: '2026-11-09', type: 'Логистика', platform: 'ozon', amount: -3120 },
  { id: 'TX-9016', date: '2026-11-09', type: 'Продажа', platform: 'wb', amount: 7470 },
  { id: 'TX-9015', date: '2026-11-08', type: 'Реклама', platform: 'ozon', amount: -5600 },
  { id: 'TX-9014', date: '2026-11-08', type: 'Комиссия', platform: 'wb', amount: -1580 },
  { id: 'TX-9013', date: '2026-11-08', type: 'Возврат', platform: 'ozon', amount: -2490 },
  { id: 'TX-9012', date: '2026-11-07', type: 'Выплата', platform: 'ozon', amount: 198450 },
  { id: 'TX-9011', date: '2026-11-07', type: 'Продажа', platform: 'wb', amount: 3730 },
  { id: 'TX-9010', date: '2026-11-07', type: 'Логистика', platform: 'wb', amount: -1840 },
];




