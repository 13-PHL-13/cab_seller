import assert from "node:assert/strict";
import test from "node:test";
import { aggregateWildberriesFinance } from "./marketplace-finance.ts";

test("aggregates finance report amounts from numeric and string fields", () => {
  const result = aggregateWildberriesFinance([
    {
      retailAmount: "1200.50",
      ppvzForPay: "870.25",
      deliveryRub: "-65.5",
      storageFee: "10",
      acceptance: 2,
      penalty: "-15",
      additionalPayment: "4.25",
      deduction: "-3",
      acquiringFee: "18",
      ppvzReward: "90",
    },
    {
      retailAmount: 300,
      ppvzForPay: 210,
      deliveryRub: -20,
      storageFee: "0.50",
      acceptance: 0,
      penalty: 0,
      additionalPayment: 0,
      deduction: 0,
      acquiringFee: 6,
      ppvzReward: 20,
    },
  ]);

  assert.deepEqual(result, {
    retailAmount: 1500.5,
    sellerPayout: 1080.25,
    delivery: -85.5,
    storage: 10.5,
    acceptance: 2,
    penalties: -15,
    additionalPayments: 4.25,
    deductions: -3,
    acquiring: 24,
    marketplaceReward: 110,
  });
});

test("ignores missing, malformed and non-finite amounts without producing NaN", () => {
  const result = aggregateWildberriesFinance([
    { retailAmount: "not-a-number", ppvzForPay: null, deliveryRub: "Infinity" },
    null,
    "not-a-row",
    { retailAmount: " 1 234,50 " },
  ]);

  assert.equal(result.retailAmount, 1234.5);
  assert.equal(result.sellerPayout, 0);
  assert.equal(result.delivery, 0);
});


import { aggregateOzonAccruals } from "./marketplace-finance-ozon.ts";

test("aggregates Ozon accrual totals by top-level category without double counting", () => {
  const result = aggregateOzonAccruals([
    { accrued_category: "POSTING", total_amount: { amount: "120.25", currency: "RUB" } },
    { accrued_category: "ITEM", total_amount: { amount: "-10.10", currency: "RUB" } },
    { accrued_category: "NON_ITEM", total_amount: { amount: "5", currency: "RUB" } },
    { accrued_category: "CONTAINER_FEES", total_amount: { amount: "-2.15", currency: "RUB" } },
    { accrued_category: "FUTURE_CATEGORY", total_amount: { amount: "1", currency: "RUB" } },
    { accrued_category: "POSTING", total_amount: { currency: "RUB" } },
  ]);

  assert.deepEqual(result, {
    accrued: 114,
    posting: 120.25,
    item: -10.1,
    nonItem: 5,
    containerFees: -2.15,
    other: 1,
    accrualsCount: 6,
    missingAmountRows: 1,
  });
});
