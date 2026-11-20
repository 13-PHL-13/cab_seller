/** Show independent amounts until every part of the profit calculation is known. */
export function storeFinanceBars(values: Array<number | null>) {
  const known = values.map(value => value !== null && Number.isFinite(value) ? value : null);
  // Expenses can already contain advertising charges. Do not infer a profit bridge
  // from these totals without an explicit, reconciled breakdown.
  return known.map(value => ({ value, from: 0, to: value ?? 0 }));
}
