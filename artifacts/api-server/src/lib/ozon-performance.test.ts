import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePerformanceCredentials, performanceConfigured, verifyPerformanceCredentials } from './ozon-performance.ts';
import { decryptCredentials, encryptCredentials } from './marketplace-credentials.ts';

const pair = { clientId: 'tutorial-client', clientSecret: 'tutorial-secret' };
test('Performance credentials require a complete bounded pair and legacy Seller credentials remain valid', () => {
  for (const value of [null, {}, { clientId: 'a' }, { clientId: ' ', clientSecret: 'x' }, { clientId: 'a'.repeat(2001), clientSecret: 'x' }]) assert.equal(parsePerformanceCredentials(value), null);
  assert.deepEqual(parsePerformanceCredentials({ clientId: ' id ', clientSecret: ' secret ', ignored: 'x' }), { clientId: 'id', clientSecret: 'secret' });
  assert.equal(performanceConfigured({ clientId: 'old-seller', apiKey: 'old-key' }), false);
  assert.equal(performanceConfigured({ clientId: 'old-seller', apiKey: 'old-key', performance: pair }), true);
});
test('verification uses only Performance credentials and discards the access token', async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++; assert.equal(url, 'https://api-performance.ozon.ru/api/client/token');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { client_id: pair.clientId, client_secret: pair.clientSecret, grant_type: 'client_credentials' });
    return Response.json({ access_token: 'temporary-token-never-returned', expires_in: 1800 });
  };
  assert.equal(await verifyPerformanceCredentials(pair, request), undefined); assert.equal(calls, 1);
});
test('provider bodies, network errors and malformed replies never disclose secrets', async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const request: typeof fetch = async () => new Response(pair.clientSecret, { status });
    await assert.rejects(verifyPerformanceCredentials(pair, request), error => error instanceof Error && !error.message.includes(pair.clientSecret));
  }
  await assert.rejects(verifyPerformanceCredentials(pair, async () => { throw Error(pair.clientSecret); }), error => error instanceof Error && !error.message.includes(pair.clientSecret));
  for (const payload of [{}, { access_token: '' }, { access_token: 123 }]) await assert.rejects(verifyPerformanceCredentials(pair, async () => Response.json(payload)));
});
test('both key pairs survive authenticated encryption without changing Seller values', () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'local-unit-test-only-not-a-production-secret';
  try {
    const old = { clientId: 'old-seller', apiKey: 'old-key' };
    const value = { ...decryptCredentials<typeof old>(encryptCredentials(old)), performance: pair };
    const encrypted = encryptCredentials(value);
    assert.ok(!encrypted.includes(pair.clientSecret)); assert.ok(!encrypted.includes(old.apiKey));
    assert.deepEqual(decryptCredentials(encrypted), { ...old, performance: pair });
    assert.notEqual(encrypted, encryptCredentials(value));
    const pieces = encrypted.split('.'); pieces[1] = Buffer.alloc(16).toString('base64');
    assert.throws(() => decryptCredentials(pieces.join('.')));
  } finally { if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous; }
});
