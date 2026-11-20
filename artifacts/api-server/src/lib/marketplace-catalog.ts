import { providerFetch } from './sync-context.ts';
export type ImportedMarketplaceProduct = {
  catalogSku: string;
  marketplaceSku: string;
  externalProductId: string;
  productName: string;
  brand: string;
  description: string;
  images: string[];
  price: string;
  marketplaceData: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function marketplaceJson(url: string, credentials: Record<string, string>, body?: unknown) {
  const response = await providerFetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(credentials.clientId
        ? { "Client-Id": credentials.clientId, "Api-Key": credentials.apiKey }
        : { Authorization: credentials.apiKey }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const details = (await response.text()).replace(/\s+/g, " ").slice(0, 250);
    const message = response.status === 401 || response.status === 403
      ? "Площадка отклонила API-ключ или его права."
      : `Площадка вернула ошибку ${response.status}${details ? `: ${details}` : ""}`;
    throw new Error(message);
  }
  const payload: unknown = await response.json();
  const result = record(payload);
  if (result["error"] || result["errors"]) throw new Error("Площадка отклонила запрос. Проверьте права API-ключа.");
  return result;
}

export async function loadProductsForImport(marketplace: "ozon" | "wildberries", credentials: Record<string, string>): Promise<ImportedMarketplaceProduct[]> {
  const result: ImportedMarketplaceProduct[] = [];
  if (marketplace === "ozon") {
    let lastId = "";
    for (let page = 0; ; page += 1) {
      const listing = await marketplaceJson("https://api-seller.ozon.ru/v3/product/list", credentials, {
        filter: { visibility: "ALL" }, last_id: lastId, limit: 100,
      });
      const listingResult = record(listing["result"]);
      if (!Array.isArray(listingResult["items"])) throw new Error("Ozon: отсутствует список товаров.");
      const items = array(listingResult["items"]).map(record);
      const ids = items.map((item) => Number(item["product_id"])).filter(Number.isFinite);
      if (!ids.length) break;
      const info = await marketplaceJson("https://api-seller.ozon.ru/v3/product/info/list", credentials, { product_id: ids });
      // Ozon's v3 product/info/list returns `items` at the top level.
      // Accept the nested form too for API gateways that wrap the response.
      const infoItems = array(info["items"] ?? record(info["result"])["items"]);
      for (const item of infoItems.map(record)) {
        const sku = String(item["offer_id"] ?? "").trim();
        if (!sku) continue;
        const catalogSku = String(array(item["barcodes"])[0] ?? sku).trim().slice(0, 120) || sku;
        const images = [...array(item["images"]), item["primary_image"]]
          .filter((image): image is string => typeof image === "string" && /^https?:\/\//i.test(image))
          .slice(0, 5);
        const price = String(record(item["price"])["price"] ?? item["price"] ?? "0").replace(/[^\d.]/g, "");
        result.push({ catalogSku, marketplaceSku: sku, externalProductId: String(item["sku"] ?? item["id"] ?? item["product_id"] ?? ""), productName: String(item["name"] ?? sku), brand: String(item["brand"] ?? ""), description: String(item["description"] ?? ""), images, price: /^\d+(?:\.\d{1,2})?$/.test(price) ? Number(price).toFixed(2) : "0.00", marketplaceData: JSON.stringify({ offerId: sku, ozonSku: item["sku"] ?? "", productId: item["id"] ?? item["product_id"] ?? "", barcode: catalogSku !== sku ? catalogSku : "", attributes: item["attributes"] ?? [] }) });
      }
      const nextId = String(listingResult["last_id"] ?? "");
      if (nextId && nextId === lastId) throw new Error("Ozon: повторный курсор каталога.");
      lastId = nextId;
      if (items.length >= 100 && !lastId) throw new Error("Ozon: отсутствует курсор продолжения каталога.");
      if (!lastId || items.length < 100) break;
    }
    return result;
  }

  let cursor: Record<string, unknown> = { limit: 100 };
  for (let page = 0; ; page += 1) {
    const response = await marketplaceJson("https://content-api.wildberries.ru/content/v2/get/cards/list", credentials, {
      settings: { cursor, filter: { withPhoto: -1 } },
    });
    if (!Array.isArray(response["cards"])) throw new Error("ВБ: отсутствует список карточек.");
    const cards = array(response["cards"]).map(record);
    for (const card of cards) {
      const sku = String(card["vendorCode"] ?? "").trim();
      if (!sku) continue;
      const firstSize = record(array(card["sizes"])[0]);
      const catalogSku = String(array(firstSize["skus"])[0] ?? sku).trim().slice(0, 120) || sku;
      const photos = array(card["photos"]).map(record).map((photo) => photo["big"] ?? photo["c246x328"])
        .filter((image): image is string => typeof image === "string" && /^https?:\/\//i.test(image)).slice(0, 5);
      result.push({ catalogSku, marketplaceSku: sku, externalProductId: String(card["nmID"] ?? ""), productName: String(card["title"] ?? sku), brand: String(card["brand"] ?? ""), description: String(card["description"] ?? ""), images: photos, price: "0.00", marketplaceData: JSON.stringify({ nmId: card["nmID"] ?? "", subjectId: card["subjectID"] ?? "", barcode: catalogSku !== sku ? catalogSku : "", characteristics: card["characteristics"] ?? [] }) });
    }
    const nextCursor = record(response["cursor"]);
    if (cards.length >= 100 && cursor.updatedAt === nextCursor.updatedAt && cursor.nmID === nextCursor.nmID) throw new Error("ВБ: повторный курсор каталога.");
    cursor = { limit: 100, updatedAt: nextCursor["updatedAt"], nmID: nextCursor["nmID"] };
    if (cards.length >= 100 && (!nextCursor["updatedAt"] || !nextCursor["nmID"])) throw new Error("ВБ: отсутствует курсор продолжения каталога.");
    if (cards.length < 100) break;
  }
  const pricesBySku = new Map<string, string>();
  {
    for (let offset = 0; ; offset += 1_000) {
      const priceResponse = await marketplaceJson(
        `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=${offset}`,
        credentials,
      );
      if (!Array.isArray(record(priceResponse["data"])["listGoods"])) throw new Error("ВБ: отсутствует список цен.");
      const goods = array(record(priceResponse["data"])["listGoods"]).map(record);
      for (const good of goods) {
        const prices = array(good["sizes"]).map(record)
          .map((size) => Number(size["discountedPrice"] ?? size["price"]))
          .filter((price) => Number.isFinite(price) && price > 0);
        if (prices.length) pricesBySku.set(String(good["vendorCode"] ?? ""), Math.min(...prices).toFixed(2));
      }
      if (goods.length < 1_000) break;
    }
  }
  for (const item of result) item.price = pricesBySku.get(item.marketplaceSku) ?? item.price;
  return result;
}
