/** Keep attached analytics valid JSON within the existing AI context limit. */
export function commerceContext(
  source: Record<string, unknown>,
  data: unknown,
) {
  function compact(value: unknown, count: number, depth = 0): unknown {
    if (depth > 8) return "Детализация сокращена";
    if (Array.isArray(value))
      return value.slice(0, count).map((v) => compact(v, count, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 60)
          .map(([k, v]) => [k, compact(v, count, depth + 1)]),
      );
    return typeof value === "string" ? value.slice(0, 1000) : value;
  }
  for (const count of [20, 10, 5, 2, 1]) {
    const payload = JSON.stringify({
      ...source,
      data: compact(data, count),
      note: `В приложенном контексте не более ${count} записей каждого списка; это не полный набор товаров. Отсутствующие показатели — null.`,
    });
    if (payload.length <= 19000) return payload;
  }
  return JSON.stringify({
    ...source,
    note: "Для этого блока передана только ссылка. Детализация слишком велика для одного сообщения.",
  });
}
