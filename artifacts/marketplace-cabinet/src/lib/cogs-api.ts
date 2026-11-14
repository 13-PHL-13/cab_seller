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
}

export interface CogsHistoryEntry {
  id: string;
  unitCost: string;
  effectiveAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
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
export function saveCogsProduct(input: Omit<CogsProduct, "id" | "currency" | "createdAt" | "updatedAt">, id?: string): Promise<CogsProduct> {
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
