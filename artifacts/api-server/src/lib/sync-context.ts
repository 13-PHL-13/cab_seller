import { AsyncLocalStorage } from 'node:async_hooks';

export class SyncDeferred extends Error {
  readonly retryAt: number;
  readonly reason: 'budget' | 'provider' | 'network';
  constructor(retryAt: number, reason: 'budget' | 'provider' | 'network' = 'budget') {
    super(`Данные загружаются в фоне. Следующая попытка: ${new Date(retryAt).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}.`);
    this.retryAt = retryAt;
    this.reason = reason;
  }
}
export class SyncRejected extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Площадка отклонила запрос (HTTP ${status}).`);
    this.status=status;
  }
}

export type SyncContext = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  deferredUntil: number[];
  sourceTimes?: number[];
};
export const syncContext = new AsyncLocalStorage<SyncContext>();

// Provider parsers remain independently testable; only a worker supplies persistence.
export function providerFetch(url: string, init: RequestInit): Promise<Response> {
  return syncContext.getStore()?.fetch(url, init) ?? fetch(url, init);
}

export function retryAtFromHeaders(headers: Headers, now: number, fallbackMs: number): number {
  const candidates: number[] = [];
  const seconds = headers.get('X-Ratelimit-Retry');
  if (seconds !== null && seconds.trim() && Number.isFinite(Number(seconds)) && Number(seconds) >= 0) {
    candidates.push(now + Math.max(1000, Number(seconds) * 1000));
  }
  const retry = headers.get('Retry-After');
  if (retry !== null && retry.trim()) {
    if (Number.isFinite(Number(retry)) && Number(retry) >= 0) candidates.push(now + Math.max(1000, Number(retry) * 1000));
    else {
      const date = Date.parse(retry);
      if (Number.isFinite(date)) candidates.push(Math.max(now + 1000, date));
    }
  }
  if (candidates.length) return Math.max(...candidates);
  // WB Reset is a duration, unlike GitHub's epoch timestamp.
  const reset = headers.get('X-Ratelimit-Reset');
  return now + Math.max(fallbackMs, reset && Number.isFinite(Number(reset)) ? Number(reset) * 1000 : 0);
}

export function syncPolicy(url: string): { group: string; interval: number; ttl: number } {
  const { hostname, pathname } = new URL(url);
  // Conservative ordinary Basic profiles, official snapshot 2026-10-18.
  // Response headers can extend these waits, never shorten them.
  if (hostname.endsWith('.wildberries.ru')) {
    if (pathname.includes('/sales-funnel/')) return { group: 'wb:funnel', interval: 30 * 60_000, ttl: 2 * 3600_000 };
    if (pathname === '/api/v1/supplier/sales') return { group: 'wb:sales', interval: 2 * 3600_000, ttl: 2 * 3600_000 };
    if (pathname.includes('/sales-reports/')) return { group: 'wb:finance', interval: 12 * 3600_000, ttl: 12 * 3600_000 };
    if (hostname.startsWith('discounts-prices-api.')) return { group: 'wb:prices', interval: 15 * 60_000, ttl: 6 * 3600_000 };
    return { group: `wb:${hostname}`, interval: 60_000, ttl: 6 * 3600_000 };
  }
  if (hostname === 'api-seller.ozon.ru') {
    // 50/day baseline for analytics; use one shared budget for all dimensions.
    if (pathname === '/v1/analytics/data') return { group: 'ozon:analytics', interval: 30 * 60_000, ttl: 2 * 3600_000 };
    return { group: `ozon:${pathname}`, interval: 1000, ttl: pathname.includes('/finance/') ? 3600_000 : 6 * 3600_000 };
  }
  throw new Error('Этот адрес не разрешён общему загрузчику.');
}

export function assertReplaySafe(url: string, method: string): void {
  const target = new URL(url);
  const allowed = new Set([
    'POST https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products',
    'GET https://statistics-api.wildberries.ru/api/v1/supplier/sales',
    'POST https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',
    'POST https://content-api.wildberries.ru/content/v2/get/cards/list',
    'GET https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter',
    'POST https://api-seller.ozon.ru/v1/analytics/data',
    'POST https://api-seller.ozon.ru/v1/finance/accrual/by-day',
    'POST https://api-seller.ozon.ru/v3/product/list',
    'POST https://api-seller.ozon.ru/v3/product/info/list',
  ]);
  if (!allowed.has(`${method.toUpperCase()} ${target.origin}${target.pathname}`)) throw new Error('Автоматический повтор разрешён только для проверенных методов чтения.');
}

export function packSyncResult(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item instanceof Map ? { __syncMap: [...item] } : item);
}
export function unpackSyncResult<T>(value: string): T {
  return JSON.parse(value, (_key, item) => item && Array.isArray(item.__syncMap) ? new Map(item.__syncMap) : item) as T;
}

export type DatasetStatus = { state: string; updatedAt: string | null; nextAttemptAt: string; stale: boolean };
export function mergeSyncStatuses(statuses: DatasetStatus[]): DatasetStatus {
  const stale = statuses.some(status=>status.stale);
  return {
    state: statuses.some(status=>status.state==='blocked') ? 'blocked' : stale ? 'waiting' : 'ready',
    stale,
    updatedAt: statuses.some(status=>!status.updatedAt) ? null : statuses.map(status=>status.updatedAt!).sort()[0] ?? null,
    nextAttemptAt: statuses.map(status=>status.nextAttemptAt).sort().at(-1) ?? new Date().toISOString(),
  };
}
