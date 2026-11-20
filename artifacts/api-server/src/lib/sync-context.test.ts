import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPolicy, assertReplaySafe, retryAtFromHeaders, packSyncResult, unpackSyncResult, syncContext, providerFetch, SyncDeferred } from './sync-context.ts';

test('ordinary WB Basic budgets remain independent and conservative', () => {
  assert.equal(syncPolicy('https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products').interval, 1800000);
  assert.equal(syncPolicy('https://statistics-api.wildberries.ru/api/v1/supplier/sales').interval, 7200000);
  assert.equal(syncPolicy('https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed').interval, 43200000);
  assert.throws(() => syncPolicy('https://untrusted.example/api'), /не разрешён/);
});
test('POST read methods can resume, while writes and redirects cannot enter the worker', () => {
  assert.doesNotThrow(() => assertReplaySafe('https://api-seller.ozon.ru/v3/product/list','POST'));
  assert.throws(() => assertReplaySafe('https://api-seller.ozon.ru/v1/product/import','POST'));
  assert.throws(() => assertReplaySafe('https://evil.example/v3/product/list','POST'));
  assert.throws(() => assertReplaySafe('https://statistics-api.wildberries.ru/api/v1/supplier/sales','DELETE'));
});
test('Retry-After HTTP dates and WB duration headers never cause an early retry', () => {
  const now = Date.parse('2026-11-20T00:00:00Z');
  assert.equal(retryAtFromHeaders(new Headers({ 'Retry-After': '7200' }), now, 60000), now + 7200000);
  assert.equal(retryAtFromHeaders(new Headers({ 'Retry-After': 'Fri, 20 Nov 2026 03:00:00 GMT' }), now, 60000), now + 10800000);
  assert.equal(retryAtFromHeaders(new Headers({ 'X-Ratelimit-Reset': '1800' }), now, 60000), now + 1800000);
  assert.equal(retryAtFromHeaders(new Headers({ 'X-Ratelimit-Retry': '3600', 'Retry-After': '1' }), now, 60000), now + 3600000);
});
test('persisted snapshots restore Map entries and nulls after a process restart', () => {
  const snapshot = { daily: new Map([['2026-11-20', { value: 0, missing: null }]]) };
  const restored = unpackSyncResult<typeof snapshot>(packSyncResult(snapshot));
  assert.ok(restored.daily instanceof Map);
  assert.deepEqual(restored.daily.get('2026-11-20'), { value: 0, missing: null });
});
test('worker context does not leak between concurrently served stores', async () => {
  const run = (store: string) => syncContext.run({ deferredUntil: [], fetch: async () => new Response(store) }, async () => (await providerFetch('https://example.invalid', {})).text());
  assert.deepEqual(await Promise.all([run('A'), run('B')]), ['A', 'B']);
  assert.equal(syncContext.getStore(), undefined);
  assert.ok(new SyncDeferred(Date.now() + 60000).message.includes('в фоне'));
});
