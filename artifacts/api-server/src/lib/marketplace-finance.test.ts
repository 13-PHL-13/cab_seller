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


import { aggregateOzonAccruals,ozonDashboardFinance,ozonDailyDashboard,ozonExpenseBreakdown } from "./marketplace-finance-ozon.ts";

test("Ozon separates promotion and FBO, reconciles delivery services and retains ordinary charges", () => {
  const labels = ["Логистика", "Обратная логистика", "Доставка до места выдачи силами Ozon",
    "Продвижение и реклама", "Услуги FBO", "Услуги партнёров", "Другие услуги и штрафы", "Прочие начисления"];
  const types = new Map(labels.map((name, index) => [index + 1, { name, description: "" }]));
  const money = (amount: number) => ({ amount: String(amount), currency: "RUB" });
  const fee = (id: number, amount: number) => ({ type_id: id, accrued: money(amount) });
  const nonItem = (id: number, amount: number) => ({
    accrued_category: "NON_ITEM", total_amount: money(amount), non_item_fee: fee(id, amount),
  });
  const posting = {
    accrued_category: "POSTING", total_amount: money(74722),
    posting: { products: [{
      commission: { sale_amount: money(172763), commission: money(-89837) },
      delivery: { total_accrued: money(-8204), services: [fee(1, -6754), fee(2, -1350), fee(3, -100)] },
    }] },
  };
  const rows = [posting, nonItem(4, -68183), nonItem(5, -14775), nonItem(6, -2122), nonItem(7, -40), nonItem(8, 25750)];
  const view = ozonExpenseBreakdown(rows, types);
  assert.ok(view.complete);
  assert.equal(view.expenses, 74453);
  assert.equal(view.ads, 68183);
  assert.equal(view.fbo, 14775);
  assert.equal((view.expenses ?? 0) + (view.ads ?? 0) + (view.fbo ?? 0), ozonDashboardFinance(rows).expenses);
  assert.deepEqual(view.articles.find(article => article.key === "delivery")?.details.map(item => item.amount), [6754, 1350, 100]);
  assert.equal(view.articles.find(article => article.key === "penalties")?.amount, 40);
  assert.ok(!view.articles.some(article => ["ads", "fbo"].includes(article.key)));
  const partial = ozonExpenseBreakdown([...rows, nonItem(100, -50)], types);
  assert.equal(partial.complete, false);
  assert.equal(partial.expenses, view.expenses);
  assert.equal(partial.unclassified[0]?.amount, 50);
});

test('daily accrual projections preserve true empty days and reject undated or out-of-period rows',()=>{
 const rows=[{date:'2026-10-01',accrued_category:'ITEM',total_amount:{amount:'-10',currency:'RUB'}},{date:'2026-10-03',accrued_category:'ITEM',total_amount:{amount:'-20',currency:'RUB'}}];
 const days=ozonDailyDashboard(rows,'2026-10-01','2026-10-03');
 assert.equal(days?.length,3);assert.equal(days?.[0].expenses,10);assert.equal(days?.[1].expenses,0);assert.equal(days?.[2].expenses,20);
 assert.equal(ozonDailyDashboard([...rows,{accrued_category:'ITEM'}],'2026-10-01','2026-10-03'),undefined);
 assert.equal(ozonDailyDashboard(rows,'2026-10-02','2026-10-03'),undefined);
});

test('Ozon dashboard reconciles realized revenue and net accruals including refunds',()=>{
  const posting=(sale:number,net:number,fee:number,delivery:number)=>({accrued_category:'POSTING',total_amount:{amount:String(net),currency:'RUB'},posting:{products:[{commission:{sale_amount:{amount:String(sale)},commission:{amount:String(fee)}},delivery:{total_accrued:{amount:String(delivery)}}}]}});
  const result=ozonDashboardFinance([posting(1000,750,-100,-150),posting(-200,-180,20,0),{accrued_category:'ITEM',total_amount:{amount:'-50',currency:'RUB'}}]);
  assert.deepEqual(result,{revenue:800,expenses:280,commission:80,logistics:150,other:50});
  assert.equal(ozonDashboardFinance([{accrued_category:'POSTING',total_amount:{amount:'750'}}]).revenue,null);
  assert.equal(ozonDashboardFinance([{accrued_category:'POSTING',total_amount:{amount:'750'}}]).expenses,null);
  assert.equal(ozonDashboardFinance([]).revenue,0);
  const deliveryOnly={accrued_category:'POSTING',total_amount:{amount:'-30',currency:'RUB'},posting:{products:[{delivery:{total_accrued:{amount:'-30'}}}]}};
  assert.deepEqual(ozonDashboardFinance([posting(1000,750,-100,-150),deliveryOnly]),{revenue:1000,expenses:280,commission:100,logistics:180,other:0});
  assert.equal(ozonDashboardFinance([{...deliveryOnly,total_amount:{amount:'400',currency:'RUB'}}]).revenue,null);
});

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
