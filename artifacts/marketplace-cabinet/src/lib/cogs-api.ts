
export type CogsMarketplace = "ozon" | "wildberries" | "both";

export interface CogsProduct {
  id: string;
  marketplace: CogsMarketplace;
  sellerSku: string;
  productName: string;
  unitCost: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
  characteristics?: string;
  unit?: string;
  countryOfOrigin?: string;
  brand?: string;
  salePrice?: string;
  description?: string;
  images?: string | string[];
  videoUrl?: string;
  publicationStatus?: string;
  marketplaces?: Array<{
    id?: string;
    marketplace: "ozon" | "wildberries";
    marketplaceSku: string;
    externalProductId: string;
    publicationStatus: string;
    importedAt?: string | null;
    lastPublishedAt?: string | null;
  }>;
}

export interface CogsHistoryEntry {
  id: string;
  unitCost: string;
  effectiveAt: string;
}

export interface CogsMinPriceResult {
  from: string; to: string; targetMarginPercent: number; formula: string;
  rows: Array<{ productId: string; sellerSku: string; productName: string; unitCost: number; salePrice: number; marketplaces: Array<{ marketplace: "ozon" | "wildberries"; payoutRate: number | null; minimumPrice: number | null; error: string | null }> }>;
}

export interface OzonCategoryType {
  categoryId: number;
  typeId: number;
  categoryName: string;
  typeName: string;
  path: string;
}

export interface MarketplaceAttribute extends Record<string, unknown> {
  id?: number;
  charcID?: number;
  name?: string;
  is_required?: boolean;
  required?: boolean;
  dictionary_id?: number;
}

export interface OzonAttributeValue {
  id: number;
  value: string;
}

export interface WildberriesSubject extends Record<string, unknown> {
  subjectID: number;
  subjectName: string;
  parentName?: string;
}

export function getOzonCategoryTypes(): Promise<{ categories: OzonCategoryType[] }> {
  return request("/api/cogs/ozon/categories");
}

export function getOzonCategoryAttributes(categoryId: number, typeId: number): Promise<{ attributes: MarketplaceAttribute[] }> {
  const query = new URLSearchParams({ categoryId: String(categoryId), typeId: String(typeId) });
  return request(`/api/cogs/ozon/attributes?${query}`);
}

export function searchOzonAttributeValues(categoryId: number, typeId: number, attributeId: number, search: string): Promise<{ values: OzonAttributeValue[] }> {
  const query = new URLSearchParams({ categoryId: String(categoryId), typeId: String(typeId), attributeId: String(attributeId), search });
  return request(`/api/cogs/ozon/attribute-values?${query}`);
}

export function searchWildberriesSubjects(search: string): Promise<{ subjects: WildberriesSubject[] }> {
  const query = new URLSearchParams({ search });
  return request(`/api/cogs/wildberries/subjects?${query}`);
}

export function getWildberriesSubjectCharacteristics(subjectId: number): Promise<{ characteristics: MarketplaceAttribute[] }> {
  return request(`/api/cogs/wildberries/subjects/${subjectId}/characteristics`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const selectedStoreId = localStorage.getItem("navigator-active-store-id") ?? "";
  if (selectedStoreId) {
    const [pathname, search = ""] = path.split("?", 2);
    const query = new URLSearchParams(search);
    query.set("storeId", selectedStoreId);
    path = `${pathname}?${query.toString()}`;
  }
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const payload: unknown = response.status === 204
    ? null
    : await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `Ошибка сервера (${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

export function listCogsProducts(): Promise<CogsProduct[]> {
  return request("/api/cogs");
}

export function getCogsMinPrices(targetMarginPercent: number): Promise<CogsMinPriceResult> {
  const query = new URLSearchParams({ targetMarginPercent: String(targetMarginPercent) });
  return request(`/api/cogs/min-prices?${query}`);
}

export function importMarketplaceProducts(marketplace: "ozon" | "wildberries"): Promise<{ imported: number; existing: number }> {
  return request(`/api/cogs/import/${marketplace}`, { method: "POST" });
}

export function publishCogsProduct(
  id: string,
  marketplace: "ozon" | "wildberries",
  input: { categoryId: string; typeId?: string; attributes: unknown[] },
): Promise<{ marketplace: string; externalProductId: string; publicationStatus: string }> {
  return request(`/api/cogs/${id}/publish/${marketplace}`, { method: "POST", body: JSON.stringify(input) });
}

export function uploadWildberriesProductMedia(id: string): Promise<{ nmId: number; photosUploaded: number; publicationStatus: string }> {
  return request(`/api/cogs/${id}/publish/wildberries/media`, { method: "POST" });
}

export function saveCogsProduct(
  input: Omit<CogsProduct, "id" | "currency" | "createdAt" | "updatedAt" | "marketplaces"> & {
    marketplaces?: Array<"ozon" | "wildberries">;
  },
  id?: string,
): Promise<CogsProduct> {
  return request(id ? `/api/cogs/${id}` : "/api/cogs", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(input),
  });
}

export function deleteCogsProduct(id: string): Promise<void> {
  return request(`/api/cogs/${id}`, { method: "DELETE" });
}

export function getCogsHistory(id: string): Promise<CogsHistoryEntry[]> {
  return request(`/api/cogs/${id}/history`);
}

export function uploadProductImages(id: string, files: File[]): Promise<CogsProduct> {
  const formData = new FormData();
  files.forEach((file) => formData.append("images", file));

  return request(`/api/cogs/${id}/media/images`, {
    method: "POST",
    body: formData,
  });
}

export function uploadProductVideo(id: string, file: File): Promise<CogsProduct> {
  const formData = new FormData();
  formData.append("video", file);

  return request(`/api/cogs/${id}/media/video`, {
    method: "POST",
    body: formData,
  });
}

export function deleteProductMedia(
  id: string,
  type: "image" | "video",
  filename: string,
): Promise<CogsProduct> {
  return request(`/api/cogs/${id}/media`, {
    method: "DELETE",
    body: JSON.stringify({ type, filename }),
  });
}
