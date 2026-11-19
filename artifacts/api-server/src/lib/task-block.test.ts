import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskBlock, mayReceiveBlock } from "./task-block.ts";
test("task snapshots reject remote URLs, SVG and oversized payloads", () => {
  const base = {
    section: "Заказы",
    stores: "Магазин",
    period: "2 недели",
    storeIds: ["1"],
  };
  assert.deepEqual(parseTaskBlock(base), base);
  for (const dataUrl of [
    "https://example.com/image.png",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64," + "A".repeat(2600001),
  ])
    assert.throws(() =>
      parseTaskBlock({
        ...base,
        image: {
          dataUrl,
          width: 400,
          height: 200,
          at: new Date().toISOString(),
        },
      }),
    );
});
test("a chart can only be delegated to a member with finance and matching store access", () => {
  const context = {
    section: "Заказы",
    stores: "Магазин",
    period: "2 недели",
    storeIds: ["1"],
  };
  const member = {
    role: "employee",
    canSeeFinance: true,
    sections: ["dashboard", "tasks"],
    storeAccess: ["1"],
  };
  assert.equal(mayReceiveBlock(member, context), true);
  assert.equal(
    mayReceiveBlock({ ...member, canSeeFinance: false }, context),
    false,
  );
  assert.equal(
    mayReceiveBlock({ ...member, storeAccess: ["2"] }, context),
    false,
  );
});
