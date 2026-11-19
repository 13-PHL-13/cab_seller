type Obj = Record<string, any>;
const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 160): v is string =>
  typeof v === "string" && v.length <= max && !/[\0]/.test(v);
const nonnegative = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9;
// Draft fields may be unfinished; only committed cost records must be numeric.
const decimal = (v: unknown) =>
  typeof v === "string"
    ? v.length <= 50
    : typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e9;
const scopes = new Set(["all", "wb", "ozon"]);
export function validateCommerceState(kind: string, value: unknown): Obj {
  if (!object(value) || JSON.stringify(value).length > 2500000)
    throw Error("Некорректный или слишком большой расчёт.");
  const unsafe = (v: unknown): boolean =>
    Array.isArray(v)
      ? v.some(unsafe)
      : object(v)
        ? Object.entries(v).some(
            ([k, x]) =>
              ["__proto__", "constructor", "prototype"].includes(k) ||
              unsafe(x),
          )
        : false;
  if (unsafe(value)) throw Error("Недопустимое поле расчёта.");
  if (kind === "costs") {
    if (
      value.version !== 2 ||
      !scopes.has(value.scope) ||
      !Array.isArray(value.records) ||
      value.records.length > 10000 ||
      !Array.isArray(value.rows) ||
      value.rows.length > 1000 ||
      !Array.isArray(value.customColumns) ||
      value.customColumns.length > 15 ||
      !object(value.costPools) ||
      !Array.isArray(value.approvals) ||
      value.approvals.length > 20000
    )
      throw Error("Проверьте структуру себестоимости.");
    const seen = new Set();
    for (const r of value.records) {
      if (
        !object(r) ||
        !text(r.sku) ||
        !r.sku.trim() ||
        !scopes.has(r.scope) ||
        !nonnegative(r.cost) ||
        !text(r.source, 200) ||
        !text(r.at, 50)
      )
        throw Error("Некорректная себестоимость товара.");
      const key = r.scope + "\0" + r.sku;
      if (seen.has(key)) throw Error("Артикул повторяется.");
      seen.add(key);
    }
    const ids = new Set<string>();
    for (const c of value.customColumns) {
      if (
        !object(c) ||
        typeof c.id !== "string" ||
        !/^extra\d+$/.test(c.id) ||
        !text(c.label, 60) ||
        !c.label.trim() ||
        ids.has(c.id)
      )
        throw Error("Проверьте дополнительные расходы.");
      ids.add(c.id);
    }
    for (const r of value.rows)
      if (
        !object(r) ||
        !text(r.id, 100) ||
        !text(r.sku) ||
        !decimal(r.qty) ||
        !object(r.values) ||
        Object.values(r.values).some((v) => !decimal(v))
      )
        throw Error("Проверьте строки ручного расчёта.");
    for (const p of Object.values(value.costPools))
      if (
        !object(p) ||
        !decimal(p.total) ||
        !["quantity", "value"].includes(p.mode)
      )
        throw Error("Проверьте распределение расходов.");
    for (const a of value.approvals)
      if (
        !object(a) ||
        !text(a.sku) ||
        !["wb", "ozon"].includes(a.market) ||
        ![5, 8, 10, 15, 20, 25, 30, 35, 40].includes(a.markup) ||
        !nonnegative(a.cost) ||
        !nonnegative(a.price) ||
        !nonnegative(a.payouts) ||
        !nonnegative(a.revenue) ||
        a.revenue <= 0 ||
        a.payouts <= 0 ||
        a.payouts > a.revenue ||
        !text(a.period, 50)
      )
        throw Error("Проверьте выбранную минимальную цену.");
    return {
      version: 2,
      scope: value.scope,
      records: value.records,
      rows: value.rows,
      customColumns: value.customColumns,
      costPools: value.costPools,
      approvals: value.approvals,
      needsAllocationReview: !!value.needsAllocationReview,
    };
  }
  if (kind === "unit") {
    if (
      value.version !== 1 ||
      !object(value.links) ||
      Object.keys(value.links).length > 10000 ||
      !object(value.settings) ||
      Object.keys(value.settings).length > 100 ||
      !Array.isArray(value.columns) ||
      value.columns.length > 20
    )
      throw Error("Проверьте настройки юнит-экономики.");
    for (const [k, v] of Object.entries(value.links))
      if (!text(k, 500) || !text(v, 500))
        throw Error("Некорректная связь товаров.");
    for (const [id, s] of Object.entries(value.settings))
      if (
        !/^\d+$/.test(id) ||
        !object(s) ||
        (s.taxRate !== null && (!nonnegative(s.taxRate) || s.taxRate > 100)) ||
        !object(s.monthly) ||
        Object.entries(s.monthly).some(
          ([m, n]) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || !nonnegative(n),
        )
      )
        throw Error("Проверьте налоговую ставку и расходы магазина.");
    const columns = new Set([
      "orders",
      "returns",
      "cancellations",
      "commission",
      "logistics",
      "ads",
      "drr",
      "other",
      "tax",
      "extra",
      "payout",
      "markup",
      "buyoutRate",
    ]);
    if (
      value.columns.some(
        (c: unknown) => typeof c !== "string" || !columns.has(c),
      )
    )
      throw Error("Некорректные столбцы.");
    return {
      version: 1,
      links: value.links,
      settings: value.settings,
      columns: [...new Set(value.columns)],
    };
  }
  throw Error("Раздел не найден.");
}
export function commercePermissions(
  role: string | undefined,
  p:
    | {
        canEditCogs?: boolean;
        canApprovePrices?: boolean;
        storeAccess?: unknown;
      }
    | undefined,
) {
  const admin = role === "owner" || role === "admin";
  return {
    edit: admin || !!p?.canEditCogs,
    approve: admin || !!p?.canApprovePrices,
    allStores: admin || p?.storeAccess === "all",
  };
}
export function commerceWriteAllowed(
  kind: string,
  previous: Obj | null,
  next: Obj,
  permissions: { edit: boolean; approve: boolean },
) {
  if (previous === null && !permissions.edit) return false;
  if (kind === "unit") return permissions.edit;
  const { approvals: oldApprovals = [], ...oldBase } = previous ?? next;
  const { approvals: newApprovals = [], ...newBase } = next;
  return (
    (permissions.edit || JSON.stringify(oldBase) === JSON.stringify(newBase)) &&
    (permissions.approve ||
      JSON.stringify(oldApprovals) === JSON.stringify(newApprovals))
  );
}
