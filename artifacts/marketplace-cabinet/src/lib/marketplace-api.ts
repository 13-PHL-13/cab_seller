export type MarketplaceId = "ozon" | "wildberries";
export type MarketplaceFilter = "all" | MarketplaceId;
export type MarketplacePeriod = "7d" | "30d" | "90d";

export interface MarketplaceConnection {
  marketplace: MarketplaceId;
  connected: boolean;
  storeName: string | null;
  lastSyncAt: string | null;
  statusMessage: string | null;
}

export interface MarketplaceDashboard {
  period: MarketplacePeriod;
  marketplace: MarketplaceFilter;
  revenue: number;
  revenueChangePercent: number | null;
  orders: number;
  units: number;
  averageOrderValue: number;
  salesSeries: Array<{
    date: string;
    ozonRevenue: number;
    wildberriesRevenue: number;
    totalRevenue: number;
  }>;
  funnels: Array<{
    marketplace: MarketplaceId;
    views: number;
    cartAdds: number;
    orders: number;
    purchases: number;
    viewToCartPercent: number;
    cartToOrderPercent: number;
    orderToPurchasePercent: number;
  }>;
  partialErrors: string[];
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Не удалось связаться с сервером. Проверьте подключение и адрес API.");
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : response.status === 401
          ? "Необходимо войти в аккаунт."
          : `Ошибка сервера (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export function getMarketplaceDashboard(
  period: MarketplacePeriod = "30d",
  marketplace: MarketplaceFilter = "all",
): Promise<MarketplaceDashboard> {
  const query = new URLSearchParams({ period, marketplace });
  return apiRequest(`/api/marketplace/dashboard?${query.toString()}`);
}

export function getMarketplaceConnections(): Promise<MarketplaceConnection[]> {
  return apiRequest("/api/marketplace/connections");
}

export function connectMarketplace(
  marketplace: MarketplaceId,
  credentials: { clientId: string; apiKey: string } | { apiKey: string },
): Promise<MarketplaceConnection> {
  return apiRequest(`/api/marketplace/connections/${marketplace === "ozon" ? "ozon" : "wildberries"}`, {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function disconnectMarketplace(marketplace: MarketplaceId): Promise<void> {
  return apiRequest(`/api/marketplace/connections/${marketplace}`, { method: "DELETE" });
}

export function formatApiError(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка.";
}
