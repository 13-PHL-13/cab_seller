import test from "node:test";
import assert from "node:assert/strict";
import {
  commercePermissions,
  commerceWriteAllowed,
  validateCommerceState,
} from "./commerce-policy.ts";
const state = () => ({
  version: 2,
  scope: "all",
  records: [
    { sku: "001", cost: 0, scope: "all", source: "Excel", at: "2026-11-20" },
  ],
  rows: [],
  costPools: { delivery: { total: "", mode: "quantity" } },
  customColumns: [],
  approvals: [],
});
test("cost state allows unfinished draft fields but never invalid committed costs", () => {
  assert.equal(validateCommerceState("costs", state()).records[0].cost, 0);
  for (const cost of [-1, NaN, Infinity, 1e10])
    assert.throws(() =>
      validateCommerceState("costs", {
        ...state(),
        records: [{ ...state().records[0], cost }],
      }),
    );
  assert.throws(() =>
    validateCommerceState("costs", {
      ...state(),
      rows: new Array(1001).fill({}),
    }),
  );
  assert.throws(() =>
    validateCommerceState("costs", JSON.parse('{"__proto__":{"bad":true}}')),
  );
});
test("cost edits and price approvals require their separate permissions, including first save", () => {
  const old = state(),
    next = { ...old, records: [] };
  assert.equal(
    commerceWriteAllowed("costs", old, next, { edit: false, approve: true }),
    false,
  );
  assert.equal(
    commerceWriteAllowed("costs", null, next, { edit: false, approve: true }),
    false,
  );
  assert.equal(
    commerceWriteAllowed("costs", old, next, { edit: true, approve: false }),
    true,
  );
  assert.equal(
    commerceWriteAllowed("unit", {}, {}, { edit: false, approve: true }),
    false,
  );
  assert.equal(
    commercePermissions("employee", { storeAccess: ["1"], canEditCogs: true })
      .allStores,
    false,
  );
  assert.equal(commercePermissions("owner", undefined).allStores, true);
});
test("unit settings reject unexpected stores, rates and columns", () => {
  const unit = {
    version: 1,
    links: {},
    settings: { 1: { taxRate: 0, monthly: { "2026-11": 100 } } },
    columns: ["ads"],
  };
  assert.equal(validateCommerceState("unit", unit).settings[1].taxRate, 0);
  assert.throws(() =>
    validateCommerceState("unit", {
      ...unit,
      settings: { 1: { taxRate: 101, monthly: {} } },
    }),
  );
  assert.throws(() =>
    validateCommerceState("unit", { ...unit, columns: ["credentials"] }),
  );
});
