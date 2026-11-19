import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { requireMarketplaceAccess } from '../middlewares/requireCompanyAccess.ts';
import { ConnectOzonBody } from '../../../../lib/api-zod/src/generated/api.ts';

function access(role: string, sections: string[], method: string) {
  let next = false, code = 0;
  const req = { companyRole: role, companyPermissions: { sections }, method } as Request;
  const res = { status(value: number) { code = value; return this; }, json() {} } as unknown as Response;
  requireMarketplaceAccess(req, res, () => { next = true; });
  return { next, code };
}
test('dashboard-only membership cannot change marketplace credentials', () => {
  assert.deepEqual(access('employee', ['dashboard'], 'GET'), { next: true, code: 0 });
  for (const method of ['PUT', 'POST', 'DELETE']) assert.deepEqual(access('employee', ['dashboard'], method), { next: false, code: 403 });
});
test('connection editors and company owners retain existing marketplace permissions', () => {
  for (const role of ['owner', 'admin']) assert.equal(access(role, [], 'PUT').next, true);
  assert.equal(access('employee', ['marketplaces'], 'PUT').next, true);
  assert.equal(access('employee', [], 'PUT').next, false);
});
test('new Ozon store contract requires both complete API pairs', () => {
  const seller = { clientId: 'test-seller', apiKey: 'test-key' };
  assert.equal(ConnectOzonBody.safeParse(seller).success, false);
  assert.equal(ConnectOzonBody.safeParse({ ...seller, performance: { clientId: 'test-perf' } }).success, false);
  assert.equal(ConnectOzonBody.safeParse({ ...seller, performance: { clientId: 'test-perf', clientSecret: 'test-secret' } }).success, true);
});
