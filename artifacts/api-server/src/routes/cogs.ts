
import { and, desc, eq, or } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db, cogsCostHistoryTable, cogsProductsTable, marketplaceConnectionsTable } from "@workspace/db";
import { cogsProductMarketplacesTable } from "@workspace/db/schema";
import { requireUser } from "../middlewares/requireUser";
import { decryptCredentials } from "../lib/marketplace-credentials";
import {
  createMediaFilename,
  ensureProductMediaDirectory,
  getProductMediaPath,
  removeProductMediaDirectory,
} from "../lib/product-media";
import {
  uploadProductImages,
  uploadProductVideo,
  validateImageSignature,
  validateVideoSignature,
} from "../lib/product-media-upload";

const router: IRouter = Router();
router.use("/cogs", requireUser);

type Marketplace = "ozon" | "wildberries" | "both";
type Product = typeof cogsProductsTable.$inferSelect;

type ProductInput = {
  marketplace: Marketplace;
  marketplaces: Array<"ozon" | "wildberries">;
  marketplaceSkus: Partial<Record<"ozon" | "wildberries", string>>;
  sellerSku: string;
  productName: string;
  unitCost: string;
  characteristics: string;
  unit: string;
  countryOfOrigin: string;
  brand: string;
  salePrice: string;
  description: string;
  images: string;
  videoUrl: string;
};

function validProductId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ownerId(req: import("express").Request): string {
  if (!req.userId) throw new Error("Authenticated user is missing");
  return req.userId;
}

function readImages(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function validMediaUrl(value: string, productId?: string): boolean {
  if (/^https?:\/\//i.test(value)) return true;

  const match = /^\/api\/cogs\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36}\.(?:jpg|jpeg|png|webp|mp4|webm))$/i.exec(value);

  return Boolean(
    match &&
    productId &&
    match[1].toLowerCase() === productId.toLowerCase(),
  );
}

function parseBody(body: unknown, productId?: string): ProductInput | null {
  if (!body || typeof body !== "object") return null;

  const value = body as Record<string, unknown>;
  const requestedMarketplaces = Array.isArray(value.marketplaces)
    ? [...new Set(value.marketplaces.filter((item): item is "ozon" | "wildberries" => item === "ozon" || item === "wildberries"))]
    : null;
  const legacyMarketplace = value.marketplace;
  const marketplaces = requestedMarketplaces ?? (legacyMarketplace === "both"
    ? ["ozon", "wildberries"]
    : legacyMarketplace === "ozon" || legacyMarketplace === "wildberries" ? [legacyMarketplace] : []);
  const marketplace = marketplaces.length === 2 ? "both" : marketplaces[0];
  const sellerSku = typeof value.sellerSku === "string" ? value.sellerSku.trim() : "";
  const productName = typeof value.productName === "string" ? value.productName.trim() : "";

  const asText = (key: string, max: number) =>
    typeof value[key] === "string"
      ? (value[key] as string).trim().slice(0, max)
      : "";

  const rawCost = value.unitCost;
  const unitCost = typeof rawCost === "number"
    ? String(rawCost)
    : typeof rawCost === "string"
      ? rawCost.trim()
      : "";

  const rawPrice = value.salePrice;
  const salePrice = typeof rawPrice === "number"
    ? String(rawPrice)
    : typeof rawPrice === "string"
      ? rawPrice.trim()
      : "0";

  const rawImages = value.images;
  const images = Array.isArray(rawImages) ? rawImages : [];

  if (marketplaces.length === 0) return null;
  if (!sellerSku || sellerSku.length > 120 || !productName || productName.length > 240) return null;

  if (
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(unitCost) ||
    !Number.isFinite(Number(unitCost)) ||
    Number(unitCost) < 0
  ) return null;

  if (
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(salePrice) ||
    !Number.isFinite(Number(salePrice)) ||
    Number(salePrice) < 0
  ) return null;

  if (
    images.length > 5 ||
    images.some(
      (item) =>
        typeof item !== "string" ||
        item.length > 2048 ||
        !validMediaUrl(item, productId),
    )
  ) return null;

  const videoUrl = asText("videoUrl", 2048);
  if (videoUrl && !validMediaUrl(videoUrl, productId)) return null;

  return {
    marketplace: marketplace as Marketplace,
    marketplaces,
    marketplaceSkus: {
      ozon: typeof (value.marketplaceSkus as Record<string, unknown> | undefined)?.ozon === "string"
        ? String((value.marketplaceSkus as Record<string, unknown>).ozon).trim().slice(0, 120) : "",
      wildberries: typeof (value.marketplaceSkus as Record<string, unknown> | undefined)?.wildberries === "string"
        ? String((value.marketplaceSkus as Record<string, unknown>).wildberries).trim().slice(0, 120) : "",
    },
    sellerSku,
    productName,
    unitCost: Number(unitCost).toFixed(2),
    characteristics: asText("characteristics", 2000),
    unit: asText("unit", 40) || "шт.",
    countryOfOrigin: asText("countryOfOrigin", 120),
    brand: asText("brand", 160),
    salePrice: Number(salePrice).toFixed(2),
    description: asText("description", 10000),
    images: JSON.stringify(images),
    videoUrl,
  };
}

async function findOwnedProduct(
  productId: string,
  userId: string,
): Promise<Product | null> {
  const [product] = await db.select().from(cogsProductsTable).where(
    and(
      eq(cogsProductsTable.id, productId),
      eq(cogsProductsTable.ownerId, userId),
    ),
  ).limit(1);

  return product ?? null;
}

const requireOwnedProductBeforeUpload: RequestHandler = (req, res, next) => {
  const productId = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id;

  if (!validProductId(productId)) {
    res.status(400).json({ error: "Некорректный идентификатор товара." });
    return;
  }

  const userId = ownerId(req);

  void findOwnedProduct(productId, userId)
    .then((product) => {
      if (!product) {
        res.status(404).json({ error: "Товар не найден." });
        return;
      }

      next();
    })
    .catch(next);
};

function multerHandler(upload: typeof uploadProductImages): RequestHandler {
  return (req, res, next) => {
    upload(req, res, (error) => {
      if (error) {
        const message = error instanceof Error
          ? error.message
          : "Ошибка загрузки файла.";

        res.status(400).json({ error: message });
        return;
      }

      next();
    });
  };
}

function imageExtension(mime: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };

  return extensions[mime] ?? "";
}

function videoExtension(mime: string): string {
  const extensions: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };

  return extensions[mime] ?? "";
}

function mediaUrl(productId: string, filename: string): string {
  return `/api/cogs/${productId}/media/${filename}`;
}

type ImportedMarketplaceProduct = {
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
  const response = await fetch(url, {
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

const ozonCategoryCache = new Map<string, { expiresAt: number; categories: Array<Record<string, unknown>> }>();

async function findMarketplaceConnection(userId: string, marketplace: "ozon" | "wildberries") {
  const [connection] = await db.select().from(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.ownerId, userId),
    eq(marketplaceConnectionsTable.marketplace, marketplace),
  )).limit(1);
  return connection;
}

function flattenOzonCategoryTree(value: unknown): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  const visit = (nodes: unknown[], path: string[]) => {
    for (const raw of nodes) {
      const node = record(raw);
      const name = String(node["category_name"] ?? "").trim();
      const nextPath = name ? [...path, name] : path;
      const categoryId = Number(node["description_category_id"]);
      const children = array(node["children"]);
      const types = children.filter((child) => {
        const item = record(child);
        return item["type_id"] !== undefined && !array(item["children"]).length;
      });
      for (const typeRaw of types) {
        const type = record(typeRaw);
        if (!node["disabled"] && !type["disabled"] && Number.isFinite(categoryId) && Number(type["type_id"]) > 0) {
          result.push({ categoryId, typeId: Number(type["type_id"]), categoryName: name, typeName: String(type["type_name"] ?? ""), path: [...nextPath, String(type["type_name"] ?? "")].filter(Boolean).join(" / ") });
        }
      }
      const childCategories = children.filter((child) => record(child)["type_id"] === undefined);
      if (childCategories.length) visit(childCategories, nextPath);
    }
  };
  visit(array(value), []);
  return result;
}

router.get("/cogs/ozon/categories", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const connection = await findMarketplaceConnection(userId, "ozon");
  if (!connection) { res.status(409).json({ error: "Сначала подключите Ozon в настройках." }); return; }
  const cached = ozonCategoryCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) { res.json({ categories: cached.categories }); return; }
  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  const response = await marketplaceJson("https://api-seller.ozon.ru/v1/description-category/tree", credentials, { language: "RU" });
  const root = record(response["result"]);
  const categories = flattenOzonCategoryTree(array(response["result"] ?? root["children"]));
  ozonCategoryCache.set(userId, { categories, expiresAt: Date.now() + 60 * 60 * 1000 });
  res.json({ categories });
});

router.get("/cogs/ozon/attributes", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const categoryId = Number(req.query.categoryId);
  const typeId = Number(req.query.typeId);
  if (!Number.isInteger(categoryId) || categoryId <= 0 || !Number.isInteger(typeId) || typeId <= 0) {
    res.status(400).json({ error: "Укажите корректные категорию и тип товара Ozon." }); return;
  }
  const connection = await findMarketplaceConnection(userId, "ozon");
  if (!connection) { res.status(409).json({ error: "Сначала подключите Ozon в настройках." }); return; }
  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  const response = await marketplaceJson("https://api-seller.ozon.ru/v1/description-category/attribute", credentials, {
    description_category_id: categoryId, type_id: typeId, language: "RU",
  });
  const result = response["result"];
  res.json({ attributes: Array.isArray(result) ? result : array(record(result)["attributes"]) });
});

router.get("/cogs/ozon/attribute-values", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const descriptionCategoryId = Number(req.query.categoryId);
  const typeId = Number(req.query.typeId);
  const attributeId = Number(req.query.attributeId);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  if (![descriptionCategoryId, typeId, attributeId].every((value) => Number.isInteger(value) && value > 0) || search.length < 2) {
    res.status(400).json({ error: "Укажите категорию, тип, атрибут Ozon и не менее двух символов для поиска." }); return;
  }
  const connection = await findMarketplaceConnection(userId, "ozon");
  if (!connection) { res.status(409).json({ error: "Сначала подключите Ozon в настройках." }); return; }
  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  const response = await marketplaceJson("https://api-seller.ozon.ru/v1/description-category/attribute/values/search", credentials, {
    attribute_id: attributeId,
    description_category_id: descriptionCategoryId,
    type_id: typeId,
    value: search,
    limit: 100,
  });
  const result = response["result"];
  res.json({ values: Array.isArray(result) ? result : array(record(result)["values"]) });
});

router.get("/cogs/wildberries/subjects", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const connection = await findMarketplaceConnection(userId, "wildberries");
  if (!connection) { res.status(409).json({ error: "Сначала подключите Wildberries в настройках." }); return; }
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  if (search.length < 2) { res.status(400).json({ error: "Введите не менее двух символов для поиска предмета." }); return; }
  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  const query = new URLSearchParams({ name: search, top: "100", offset: "0" });
  const response = await marketplaceJson(`https://content-api.wildberries.ru/content/v2/object/all?${query}`, credentials);
  res.json({ subjects: array(response["data"] ?? response["result"]) });
});

router.get("/cogs/wildberries/subjects/:subjectId/characteristics", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const subjectId = Number(Array.isArray(req.params.subjectId) ? req.params.subjectId[0] : req.params.subjectId);
  if (!Number.isInteger(subjectId) || subjectId <= 0) { res.status(400).json({ error: "Некорректный ID предмета Wildberries." }); return; }
  const connection = await findMarketplaceConnection(userId, "wildberries");
  if (!connection) { res.status(409).json({ error: "Сначала подключите Wildberries в настройках." }); return; }
  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  const response = await marketplaceJson(`https://content-api.wildberries.ru/content/v2/object/charcs/${subjectId}`, credentials);
  res.json({ characteristics: array(response["data"] ?? response["result"]) });
});

async function loadProductsForImport(marketplace: "ozon" | "wildberries", credentials: Record<string, string>): Promise<ImportedMarketplaceProduct[]> {
  const result: ImportedMarketplaceProduct[] = [];
  if (marketplace === "ozon") {
    let lastId = "";
    for (let page = 0; page < 5; page += 1) {
      const listing = await marketplaceJson("https://api-seller.ozon.ru/v3/product/list", credentials, {
        filter: { visibility: "ALL" }, last_id: lastId, limit: 100,
      });
      const listingResult = record(listing["result"]);
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
        result.push({ catalogSku, marketplaceSku: sku, externalProductId: String(item["id"] ?? item["product_id"] ?? ""), productName: String(item["name"] ?? sku), brand: String(item["brand"] ?? ""), description: String(item["description"] ?? ""), images, price: /^\d+(?:\.\d{1,2})?$/.test(price) ? Number(price).toFixed(2) : "0.00", marketplaceData: JSON.stringify({ offerId: sku, productId: item["id"] ?? item["product_id"] ?? "", barcode: catalogSku !== sku ? catalogSku : "", attributes: item["attributes"] ?? [] }) });
      }
      lastId = String(listingResult["last_id"] ?? "");
      if (!lastId || items.length < 100) break;
    }
    return result;
  }

  let cursor: Record<string, unknown> = { limit: 100 };
  for (let page = 0; page < 5; page += 1) {
    const response = await marketplaceJson("https://content-api.wildberries.ru/content/v2/get/cards/list", credentials, {
      settings: { cursor, filter: { withPhoto: -1 } },
    });
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
    cursor = { limit: 100, updatedAt: nextCursor["updatedAt"], nmID: nextCursor["nmID"] };
    if (cards.length < 100 || !nextCursor["updatedAt"] || !nextCursor["nmID"]) break;
  }
  const pricesBySku = new Map<string, string>();
  try {
    for (let offset = 0; offset < 10_000; offset += 1_000) {
      const priceResponse = await marketplaceJson(
        `https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=${offset}`,
        credentials,
      );
      const goods = array(record(priceResponse["data"])["listGoods"]).map(record);
      for (const good of goods) {
        const prices = array(good["sizes"]).map(record)
          .map((size) => Number(size["discountedPrice"] ?? size["price"]))
          .filter((price) => Number.isFinite(price) && price > 0);
        if (prices.length) pricesBySku.set(String(good["vendorCode"] ?? ""), Math.min(...prices).toFixed(2));
      }
      if (goods.length < 1_000) break;
    }
  } catch {
    // Product-card import remains useful for API keys without price-read permission.
  }
  for (const item of result) item.price = pricesBySku.get(item.marketplaceSku) ?? item.price;
  return result;
}

router.get("/cogs", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const rows = await db.select().from(cogsProductsTable)
    .where(eq(cogsProductsTable.ownerId, userId))
    .orderBy(desc(cogsProductsTable.updatedAt));
  const links = await db.select().from(cogsProductMarketplacesTable)
    .where(eq(cogsProductMarketplacesTable.ownerId, userId));
  const linksByProduct = new Map<string, typeof links>();
  for (const link of links) linksByProduct.set(link.productId, [...(linksByProduct.get(link.productId) ?? []), link]);
  res.json(rows.map((product) => {
    const savedLinks = linksByProduct.get(product.id);
    const marketplaces = savedLinks?.length ? savedLinks : (product.marketplace === "both"
      ? [{ marketplace: "ozon", marketplaceSku: product.sellerSku, externalProductId: "", publicationStatus: product.publicationStatus }, { marketplace: "wildberries", marketplaceSku: product.sellerSku, externalProductId: "", publicationStatus: product.publicationStatus }]
      : [{ marketplace: product.marketplace, marketplaceSku: product.sellerSku, externalProductId: "", publicationStatus: product.publicationStatus }]);
    return { ...product, marketplaces };
  }));
});

router.post("/cogs/import/:marketplace", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const marketplace = Array.isArray(req.params.marketplace) ? req.params.marketplace[0] : req.params.marketplace;
  if (marketplace !== "ozon" && marketplace !== "wildberries") {
    res.status(400).json({ error: "Неизвестная торговая площадка." });
    return;
  }
  const [connection] = await db.select().from(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.ownerId, userId),
    eq(marketplaceConnectionsTable.marketplace, marketplace),
  )).limit(1);
  if (!connection) {
    res.status(409).json({ error: "Сначала подключите площадку в настройках." });
    return;
  }

  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  let imported: ImportedMarketplaceProduct[];
  try {
    imported = await loadProductsForImport(marketplace, credentials);
  } catch (error) {
    req.log.warn({ marketplace, err: error }, "Marketplace catalog import request failed");
    res.status(502).json({
      error: error instanceof Error ? error.message : "Не удалось прочитать каталог площадки.",
    });
    return;
  }
  let created = 0;
  let existing = 0;
  for (const item of imported) {
    const matchConditions = [eq(cogsProductMarketplacesTable.marketplaceSku, item.marketplaceSku)];
    if (item.externalProductId) matchConditions.push(eq(cogsProductMarketplacesTable.externalProductId, item.externalProductId));
    const [linked] = await db.select({ id: cogsProductMarketplacesTable.id, productId: cogsProductMarketplacesTable.productId })
      .from(cogsProductMarketplacesTable).where(and(
        eq(cogsProductMarketplacesTable.ownerId, userId),
        eq(cogsProductMarketplacesTable.marketplace, marketplace),
        or(...matchConditions),
      )).limit(1);
    if (linked) {
      await db.update(cogsProductMarketplacesTable).set({
        externalProductId: item.externalProductId,
        publicationStatus: "published",
        importedAt: new Date(),
        marketplaceData: item.marketplaceData,
        updatedAt: new Date(),
      }).where(eq(cogsProductMarketplacesTable.id, linked.id));
      existing += 1;
      continue;
    }

    const [sameSku] = await db.select({ id: cogsProductsTable.id })
      .from(cogsProductsTable).where(and(
        eq(cogsProductsTable.ownerId, userId),
        eq(cogsProductsTable.sellerSku, item.catalogSku),
      )).limit(1);
    const product = await db.transaction(async (tx) => {
      let productId = sameSku?.id;
      if (!productId) {
        const [row] = await tx.insert(cogsProductsTable).values({
          ownerId: userId,
          marketplace,
          sellerSku: item.catalogSku,
          productName: item.productName.slice(0, 240),
          unitCost: "0.00",
          salePrice: item.price,
          brand: item.brand.slice(0, 160),
          description: item.description.slice(0, 10_000),
          images: JSON.stringify(item.images),
          publicationStatus: "imported",
        }).returning({ id: cogsProductsTable.id });
        productId = row.id;
        await tx.insert(cogsCostHistoryTable).values({ ownerId: userId, productId, unitCost: "0.00" });
      }
      await tx.insert(cogsProductMarketplacesTable).values({
        ownerId: userId,
        productId,
        marketplace,
        marketplaceSku: item.marketplaceSku,
        externalProductId: item.externalProductId,
        publicationStatus: "published",
        importedAt: new Date(),
        marketplaceData: item.marketplaceData,
      }).onConflictDoUpdate({
        target: [cogsProductMarketplacesTable.productId, cogsProductMarketplacesTable.marketplace],
        set: { marketplaceSku: item.marketplaceSku, externalProductId: item.externalProductId, publicationStatus: "published", importedAt: new Date(), marketplaceData: item.marketplaceData, updatedAt: new Date() },
      });
      return productId;
    });
    if (product) {
      if (sameSku) existing += 1;
      else created += 1;
    }
  }
  await db.update(marketplaceConnectionsTable).set({ lastSyncAt: new Date() })
    .where(eq(marketplaceConnectionsTable.id, connection.id));
  req.log.info({ marketplace, imported: created, existing }, "Catalog products imported");
  res.json({ imported: created, existing });
});

router.post("/cogs/:id/publish/:marketplace", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const marketplace = Array.isArray(req.params.marketplace) ? req.params.marketplace[0] : req.params.marketplace;
  if (!validProductId(productId) || (marketplace !== "ozon" && marketplace !== "wildberries")) {
    res.status(400).json({ error: "Некорректный товар или площадка." });
    return;
  }
  const product = await findOwnedProduct(productId, userId);
  if (!product) { res.status(404).json({ error: "Товар не найден." }); return; }

  const body = record(req.body);
  const categoryId = String(body["categoryId"] ?? "").trim();
  const typeId = String(body["typeId"] ?? "").trim();
  let attributes: unknown;
  try { attributes = typeof body["attributes"] === "string" ? JSON.parse(body["attributes"]) : body["attributes"]; }
  catch { res.status(400).json({ error: "Атрибуты должны быть корректным JSON-массивом." }); return; }
  if (!categoryId || (marketplace === "ozon" && !typeId) || !Array.isArray(attributes)) {
    res.status(400).json({ error: marketplace === "ozon"
      ? "Для Ozon укажите ID категории, ID типа и JSON-массив обязательных атрибутов."
      : "Для Wildberries укажите ID предмета и JSON-массив обязательных характеристик." });
    return;
  }
  if (!/^\d+$/.test(categoryId) || (typeId && !/^\d+$/.test(typeId))) {
    res.status(400).json({ error: "ID категории, типа или предмета должен быть числом." });
    return;
  }
  const images = readImages(product.images);
  if (!images.length) {
    res.status(400).json({ error: "Добавьте хотя бы одну фотографию по общедоступной HTTPS-ссылке перед публикацией." });
    return;
  }
  if (images.some((url) => !/^https:\/\//i.test(url))) {
    res.status(400).json({ error: "Для публикации площадка должна получить общедоступные HTTPS-ссылки на фотографии." });
    return;
  }
  const [connection] = await db.select().from(marketplaceConnectionsTable).where(and(
    eq(marketplaceConnectionsTable.ownerId, userId), eq(marketplaceConnectionsTable.marketplace, marketplace),
  )).limit(1);
  if (!connection) { res.status(409).json({ error: "Сначала подключите площадку в настройках." }); return; }
  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  const [link] = await db.select().from(cogsProductMarketplacesTable).where(and(
    eq(cogsProductMarketplacesTable.ownerId, userId),
    eq(cogsProductMarketplacesTable.productId, productId),
    eq(cogsProductMarketplacesTable.marketplace, marketplace),
  )).limit(1);
  const marketplaceSku = link?.marketplaceSku || product.sellerSku;
  const configuration = { categoryId, ...(typeId ? { typeId } : {}), attributes };

  let response: Record<string, unknown>;
  if (marketplace === "ozon") {
    const ozonAttributes = attributes.map((value) => record(value));
    const ozonImportAttributes = [
      ...ozonAttributes.filter((attribute) => Number(attribute["id"] ?? attribute["attribute_id"]) !== 8229),
      {
        id: 8229,
        complex_id: 0,
        values: [{ dictionary_value_id: Number(typeId) }],
      },
    ];
    response = await marketplaceJson("https://api-seller.ozon.ru/v3/product/import", credentials, {
      items: [{
        offer_id: marketplaceSku,
        name: product.productName,
        description: product.description,
        description_category_id: Number(categoryId),
        price: product.salePrice,
        currency_code: product.currency,
        images,
        attributes: ozonImportAttributes,
      }],
    });
  } else {
    const subjectID = Number(categoryId);
    if (!Number.isInteger(subjectID) || subjectID <= 0) {
      res.status(400).json({ error: "ID предмета Wildberries должен быть положительным числом." });
      return;
    }
    response = await marketplaceJson("https://content-api.wildberries.ru/content/v2/cards/upload", credentials, [{
      subjectID,
      variants: [{
        vendorCode: marketplaceSku,
        title: product.productName,
        description: product.description,
        brand: product.brand,
        characteristics: attributes,
        sizes: [{ techSize: "0", skus: [marketplaceSku] }],
      }],
    }]);
  }

  const resultRecord = record(response["result"]);
  const externalProductId = String(resultRecord["task_id"] ?? resultRecord["taskId"] ?? link?.externalProductId ?? "");
  let existingData: Record<string, unknown> = {};
  try { existingData = link ? record(JSON.parse(link.marketplaceData || "{}")) : {}; } catch { /* replace malformed legacy metadata */ }
  const savedData = JSON.stringify({ ...existingData, ...configuration });
  await db.insert(cogsProductMarketplacesTable).values({
    ownerId: userId, productId, marketplace, marketplaceSku, externalProductId,
    publicationStatus: "submitted", lastPublishedAt: new Date(), marketplaceData: savedData,
  }).onConflictDoUpdate({
    target: [cogsProductMarketplacesTable.productId, cogsProductMarketplacesTable.marketplace],
    set: { marketplaceSku, externalProductId, publicationStatus: "submitted", lastPublishedAt: new Date(), marketplaceData: savedData, updatedAt: new Date() },
  });
  res.json({ marketplace, externalProductId, publicationStatus: "submitted" });
});

router.post("/cogs/:id/publish/wildberries/media", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!validProductId(productId)) { res.status(400).json({ error: "Некорректный товар." }); return; }
  const product = await findOwnedProduct(productId, userId);
  if (!product) { res.status(404).json({ error: "Товар не найден." }); return; }
  const connection = await findMarketplaceConnection(userId, "wildberries");
  if (!connection) { res.status(409).json({ error: "Сначала подключите Wildberries в настройках." }); return; }
  const [link] = await db.select().from(cogsProductMarketplacesTable).where(and(
    eq(cogsProductMarketplacesTable.ownerId, userId),
    eq(cogsProductMarketplacesTable.productId, productId),
    eq(cogsProductMarketplacesTable.marketplace, "wildberries"),
  )).limit(1);
  if (!link?.marketplaceSku) { res.status(409).json({ error: "Сначала отправьте карточку товара на Wildberries." }); return; }
  const images = readImages(product.images);
  if (!images.length || images.some((url) => !/^https:\/\//i.test(url))) {
    res.status(400).json({ error: "Wildberries принимает прямые общедоступные HTTPS-ссылки на фотографии. Добавьте их в карточку товара." }); return;
  }
  const credentials = decryptCredentials<Record<string, string>>(connection.credentialsCiphertext);
  const response = await marketplaceJson("https://content-api.wildberries.ru/content/v2/get/cards/list", credentials, {
    settings: { sort: { ascending: false }, cursor: { limit: 100 }, filter: { textSearch: link.marketplaceSku, withPhoto: -1 } },
  });
  const listings = array(response["cards"] ?? record(response["data"])["cards"]);
  const card = listings.map(record).find((item) => String(item["vendorCode"] ?? "") === link.marketplaceSku);
  const nmId = Number(card?.["nmID"]);
  if (!Number.isInteger(nmId) || nmId <= 0) {
    res.status(409).json({ error: "Карточка ещё обрабатывается Wildberries и пока не появилась в списке. Повторите загрузку фото позже." }); return;
  }
  await marketplaceJson("https://content-api.wildberries.ru/content/v3/media/save", credentials, { nmId, data: images });
  let existingData: Record<string, unknown> = {};
  try { existingData = record(JSON.parse(link.marketplaceData || "{}")); } catch { /* replace malformed legacy metadata */ }
  await db.update(cogsProductMarketplacesTable).set({
    externalProductId: String(nmId),
    marketplaceData: JSON.stringify({ ...existingData, mediaUploadedAt: new Date().toISOString() }),
    updatedAt: new Date(),
  }).where(and(eq(cogsProductMarketplacesTable.productId, productId), eq(cogsProductMarketplacesTable.marketplace, "wildberries")));
  res.json({ nmId, photosUploaded: images.length, publicationStatus: link.publicationStatus });
});

router.get("/cogs/:id/history", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!validProductId(productId)) {
    res.status(400).json({ error: "Некорректный идентификатор товара." });
    return;
  }

  const product = await findOwnedProduct(productId, userId);

  if (!product) {
    res.status(404).json({ error: "Товар не найден." });
    return;
  }

  const rows = await db.select().from(cogsCostHistoryTable)
    .where(and(
      eq(cogsCostHistoryTable.productId, productId),
      eq(cogsCostHistoryTable.ownerId, userId),
    ))
    .orderBy(desc(cogsCostHistoryTable.effectiveAt));

  res.json(rows);
});

router.post("/cogs", async (req, res): Promise<void> => {
  const parsed = parseBody(req.body);

  if (!parsed) {
    res.status(400).json({ error: "Проверьте площадку, артикул, название и себестоимость." });
    return;
  }

  const userId = ownerId(req);
  const { marketplaces, marketplaceSkus, ...productValues } = parsed;

  const [existing] = await db.select({ id: cogsProductsTable.id })
    .from(cogsProductsTable)
    .where(and(
      eq(cogsProductsTable.ownerId, userId),
      eq(cogsProductsTable.marketplace, parsed.marketplace),
      eq(cogsProductsTable.sellerSku, parsed.sellerSku),
    ))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Такой артикул для выбранной площадки уже есть." });
    return;
  }

  const [created] = await db.transaction(async (tx) => {
    const [product] = await tx.insert(cogsProductsTable)
      .values({ ownerId: userId, ...productValues })
      .returning();

    await tx.insert(cogsCostHistoryTable).values({
      ownerId: userId,
      productId: product.id,
      unitCost: parsed.unitCost,
    });

    await tx.insert(cogsProductMarketplacesTable).values(marketplaces.map((marketplace) => ({
      ownerId: userId,
      productId: product.id,
      marketplace,
      marketplaceSku: marketplaceSkus[marketplace] || parsed.sellerSku,
    }))).onConflictDoNothing();

    return [{ ...product, marketplaces: marketplaces.map((marketplace) => ({
      marketplace,
      marketplaceSku: marketplaceSkus[marketplace] || parsed.sellerSku,
      externalProductId: "",
      publicationStatus: "draft",
    })) }];
  });

  res.status(201).json(created);
});

router.put("/cogs/:id", async (req, res): Promise<void> => {
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!validProductId(productId)) {
    res.status(400).json({ error: "Некорректный идентификатор товара." });
    return;
  }

  const parsed = parseBody(req.body, productId);

  if (!parsed) {
    res.status(400).json({ error: "Проверьте данные товара и адреса медиафайлов." });
    return;
  }

  const userId = ownerId(req);
  const { marketplaces, marketplaceSkus, ...productValues } = parsed;
  const existing = await findOwnedProduct(productId, userId);

  if (!existing) {
    res.status(404).json({ error: "Товар не найден." });
    return;
  }

  const [conflict] = await db.select({ id: cogsProductsTable.id })
    .from(cogsProductsTable)
    .where(and(
      eq(cogsProductsTable.ownerId, userId),
      eq(cogsProductsTable.marketplace, parsed.marketplace),
      eq(cogsProductsTable.sellerSku, parsed.sellerSku),
    ))
    .limit(1);

  if (conflict && conflict.id !== existing.id) {
    res.status(409).json({ error: "Такой артикул для выбранной площадки уже есть." });
    return;
  }

  const [updated] = await db.transaction(async (tx) => {
    const [product] = await tx.update(cogsProductsTable)
      .set({ ...productValues, updatedAt: new Date() })
      .where(and(
        eq(cogsProductsTable.id, existing.id),
        eq(cogsProductsTable.ownerId, userId),
      ))
      .returning();

    if (existing.unitCost !== parsed.unitCost) {
      await tx.insert(cogsCostHistoryTable).values({
        ownerId: userId,
        productId: existing.id,
        unitCost: parsed.unitCost,
      });
    }

    const currentLinks = await tx.select().from(cogsProductMarketplacesTable)
      .where(eq(cogsProductMarketplacesTable.productId, existing.id));
    for (const link of currentLinks) {
      if (link.publicationStatus === "draft" && !marketplaces.includes(link.marketplace as "ozon" | "wildberries")) {
        await tx.delete(cogsProductMarketplacesTable).where(eq(cogsProductMarketplacesTable.id, link.id));
      }
    }
    for (const marketplace of marketplaces) {
      const marketplaceSku = marketplaceSkus[marketplace] || parsed.sellerSku;
      await tx.insert(cogsProductMarketplacesTable).values({
        ownerId: userId, productId: existing.id, marketplace, marketplaceSku,
      }).onConflictDoUpdate({
        target: [cogsProductMarketplacesTable.productId, cogsProductMarketplacesTable.marketplace],
        set: { marketplaceSku, updatedAt: new Date() },
      });
    }

    const links = await tx.select().from(cogsProductMarketplacesTable)
      .where(eq(cogsProductMarketplacesTable.productId, existing.id));
    return [{ ...product, marketplaces: links }];
  });

  res.json(updated);
});

// Загрузка фотографий. Файлы сначала проверяются в памяти.
router.post(
  "/cogs/:id/media/images",
  requireOwnedProductBeforeUpload,
  multerHandler(uploadProductImages),
  async (req, res): Promise<void> => {
    const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!validProductId(productId)) {
      res.status(400).json({ error: "Некорректный идентификатор товара." });
      return;
    }

    const userId = ownerId(req);
    const product = await findOwnedProduct(productId, userId);

    if (!product) {
      res.status(404).json({ error: "Товар не найден." });
      return;
    }

    const files = (req.files ?? []) as Express.Multer.File[];
    if (!files.length) {
      res.status(400).json({ error: "Выберите хотя бы одну фотографию." });
      return;
    }

    if (files.some((file) => !validateImageSignature(file))) {
      res.status(400).json({ error: "Содержимое одного из файлов не соответствует формату изображения." });
      return;
    }

    const currentImages = readImages(product.images);

    if (currentImages.length + files.length > 5) {
      res.status(400).json({ error: "У товара может быть не более пяти фотографий." });
      return;
    }

    const directory = await ensureProductMediaDirectory(userId, productId);
    const savedPaths: string[] = [];

    try {
      for (const file of files) {
        const filename = createMediaFilename(imageExtension(file.mimetype));
        const destination = path.join(directory, filename);

        await writeFile(destination, file.buffer, { flag: "wx" });
        savedPaths.push(mediaUrl(productId, filename));
      }

      const updatedImages = [...currentImages, ...savedPaths];

      const [updated] = await db.update(cogsProductsTable)
        .set({
          images: JSON.stringify(updatedImages),
          updatedAt: new Date(),
        })
        .where(and(
          eq(cogsProductsTable.id, productId),
          eq(cogsProductsTable.ownerId, userId),
        ))
        .returning();

      res.json(updated);
    } catch (error) {
      for (const url of savedPaths) {
        const filename = url.split("/").pop();
        if (filename) {
          await unlink(getProductMediaPath(userId, productId, filename)).catch(() => {});
        }
      }

      throw error;
    }
  },
);

// Загрузка видео. Новое видео заменяет старое.
router.post(
  "/cogs/:id/media/video",
  requireOwnedProductBeforeUpload,
  multerHandler(uploadProductVideo),
  async (req, res): Promise<void> => {
    const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!validProductId(productId)) {
      res.status(400).json({ error: "Некорректный идентификатор товара." });
      return;
    }

    const userId = ownerId(req);
    const product = await findOwnedProduct(productId, userId);

    if (!product) {
      res.status(404).json({ error: "Товар не найден." });
      return;
    }

    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "Выберите видеофайл." });
      return;
    }

    if (!validateVideoSignature(file)) {
      res.status(400).json({ error: "Содержимое файла не соответствует формату видео." });
      return;
    }

    const directory = await ensureProductMediaDirectory(userId, productId);
    const filename = createMediaFilename(videoExtension(file.mimetype));
    const destination = path.join(directory, filename);

    await writeFile(destination, file.buffer, { flag: "wx" });

    try {
      const [updated] = await db.update(cogsProductsTable)
        .set({
          videoUrl: mediaUrl(productId, filename),
          updatedAt: new Date(),
        })
        .where(and(
          eq(cogsProductsTable.id, productId),
          eq(cogsProductsTable.ownerId, userId),
        ))
        .returning();

      if (product.videoUrl.startsWith(`/api/cogs/${productId}/media/`)) {
        const oldFilename = product.videoUrl.split("/").pop();

        if (oldFilename) {
          await unlink(getProductMediaPath(userId, productId, oldFilename)).catch(() => {});
        }
      }

      res.json(updated);
    } catch (error) {
      await unlink(destination).catch(() => {});
      throw error;
    }
  },
);

// Защищённая выдача файла.
router.get("/cogs/:id/media/:filename", async (req, res, next): Promise<void> => {
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const filename = req.params.filename;

  if (!validProductId(productId)) {
    res.status(400).json({ error: "Некорректный идентификатор товара." });
    return;
  }

  const userId = ownerId(req);
  const product = await findOwnedProduct(productId, userId);

  if (!product) {
    res.status(404).json({ error: "Товар не найден." });
    return;
  }

  const expectedUrl = mediaUrl(productId, filename);
  const belongsToProduct =
    readImages(product.images).includes(expectedUrl) ||
    product.videoUrl === expectedUrl;

  if (!belongsToProduct) {
    res.status(404).json({ error: "Файл не найден." });
    return;
  }

  let filePath: string;

  try {
    filePath = getProductMediaPath(userId, productId, filename);
  } catch {
    res.status(400).json({ error: "Некорректное имя файла." });
    return;
  }

  res.sendFile(filePath, (error) => {
    if (error) next(error);
  });
});

// Удаление одной фотографии или видео.
router.delete("/cogs/:id/media", async (req, res): Promise<void> => {
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!validProductId(productId)) {
    res.status(400).json({ error: "Некорректный идентификатор товара." });
    return;
  }

  const userId = ownerId(req);
  const product = await findOwnedProduct(productId, userId);

  if (!product) {
    res.status(404).json({ error: "Товар не найден." });
    return;
  }

  const body = req.body as { type?: unknown; filename?: unknown } | undefined;
  const type = body?.type;
  const filename = body?.filename;

  if (
    (type !== "image" && type !== "video") ||
    typeof filename !== "string"
  ) {
    res.status(400).json({ error: "Некорректные параметры удаления." });
    return;
  }

  const expectedUrl = mediaUrl(productId, filename);
  const images = readImages(product.images);
  let updatedImages = images;
  let updatedVideo = product.videoUrl;

  if (type === "image" && images.includes(expectedUrl)) {
    updatedImages = images.filter((url) => url !== expectedUrl);
  } else if (type === "video" && product.videoUrl === expectedUrl) {
    updatedVideo = "";
  } else {
    res.status(404).json({ error: "Медиафайл не найден." });
    return;
  }

  const [updated] = await db.update(cogsProductsTable)
    .set({
      images: JSON.stringify(updatedImages),
      videoUrl: updatedVideo,
      updatedAt: new Date(),
    })
    .where(and(
      eq(cogsProductsTable.id, productId),
      eq(cogsProductsTable.ownerId, userId),
    ))
    .returning();

  await unlink(getProductMediaPath(userId, productId, filename)).catch(() => {});

  res.json(updated);
});

router.delete("/cogs/:id", async (req, res): Promise<void> => {
  const productId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!validProductId(productId)) {
    res.status(400).json({ error: "Некорректный идентификатор товара." });
    return;
  }

  const userId = ownerId(req);

  const deleted = await db.delete(cogsProductsTable)
    .where(and(
      eq(cogsProductsTable.id, productId),
      eq(cogsProductsTable.ownerId, userId),
    ))
    .returning({ id: cogsProductsTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "Товар не найден." });
    return;
  }

  await removeProductMediaDirectory(userId, productId).catch(() => {});

  res.sendStatus(204);
});

export default router;
