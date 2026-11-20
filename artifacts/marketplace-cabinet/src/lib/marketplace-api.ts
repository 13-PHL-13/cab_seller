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
export interface MarketplaceStore { id: number; marketplace: MarketplaceId; storeName: string; lastSyncAt: string | null; performanceConnected?: boolean }

export interface AiAssistantConfig {
  configured: boolean;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

export function getAiAssistantConfig(): Promise<AiAssistantConfig> {
  return apiRequest("/api/marketplace/ai-config");
}

export function fetchAiModels(baseUrl: string, apiKey: string): Promise<{ models: string[] }> {
  return apiRequest("/api/marketplace/ai-models", {
    method: "POST",
    body: JSON.stringify({ baseUrl, apiKey }),
  });
}

export function saveAiAssistantConfig(input: { baseUrl: string; apiKey: string; model: string }): Promise<AiAssistantConfig> {
  return apiRequest("/api/marketplace/ai-config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function disconnectAiAssistant(): Promise<void> {
  return apiRequest("/api/marketplace/ai-config", { method: "DELETE" });
}

export function sendAiAssistantMessage(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  context: string,
  conversationId?: string | null,
): Promise<{ answer: string; conversationId: string }> {
  return apiRequest("/api/marketplace/ai-chat", {
    method: "POST",
    body: JSON.stringify({ messages, context, ...(conversationId ? { conversationId } : {}) }),
  });
}

export function getAiAssistantChat(): Promise<{ conversationId: string | null; messages: Array<{ role: "assistant" | "user"; content: string; createdAt: string }> }> {
  return apiRequest("/api/marketplace/ai-chat");
}

export function startAiAssistantChat(context: string): Promise<{ conversationId: string }> {
  return apiRequest("/api/marketplace/ai-chat/new", { method: "POST", body: JSON.stringify({ context }) });
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

export class MarketplaceSyncPendingError extends Error {}

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
    if (payload && typeof payload === 'object' && 'syncPending' in payload && payload.syncPending === true) throw new MarketplaceSyncPendingError(message);
    throw new Error(message);
  }
  return payload as T;
}

export function getMarketplaceDashboard(
  period: MarketplacePeriod = "30d",
  marketplace: MarketplaceFilter = "all",
): Promise<MarketplaceDashboard> {
  const query = new URLSearchParams({ period, marketplace });
  const selectedStoreId = localStorage.getItem("navigator-active-store-id") ?? "";
  if (selectedStoreId) query.set("storeId", selectedStoreId);
  return apiRequest(`/api/marketplace/dashboard?${query.toString()}`);
}

export function getMarketplaceConnections(): Promise<MarketplaceConnection[]> {
  const selectedStoreId = localStorage.getItem("navigator-active-store-id") ?? "";
  return apiRequest(`/api/marketplace/connections${selectedStoreId ? `?storeId=${encodeURIComponent(selectedStoreId)}` : ""}`);
}

export function getMarketplaceStores(): Promise<{ stores: MarketplaceStore[] }> {
  return apiRequest("/api/marketplace/stores");
}

export function deleteMarketplaceStore(id: number): Promise<void> {
  return apiRequest(`/api/marketplace/stores/${id}`, { method: "DELETE" });
}

export function connectMarketplace(
  marketplace: MarketplaceId,
  credentials: { clientId: string; apiKey: string; storeName?: string; performance?: { clientId: string; clientSecret: string } } | { apiKey: string; storeName?: string },
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


export interface WildberriesFinanceReport {
  marketplace: "wildberries";
  currency: string | null;
  from: string;
  to: string;
  rowsCount: number;
  incomplete: boolean;
  soldItems: Array<{ sellerSku: string; externalProductId: string; quantity: number }>;
  catalogCost?: { matchedUnits: number; unmatchedUnits: number; costOfGoods: number };
  productSalesError?: string | null;
  productSalesMetric?: "ordered_units" | null;
  totals: {
    retailAmount: number;
    sellerPayout: number;
    delivery: number;
    storage: number;
    acceptance: number;
    penalties: number;
    additionalPayments: number;
    deductions: number;
    acquiring: number;
    marketplaceReward: number;
  };
}

export function getWildberriesFinanceReport(
  from: string,
  to: string,
): Promise<WildberriesFinanceReport> {
  const query = new URLSearchParams({ from, to });
  const selectedStoreId = localStorage.getItem("navigator-active-store-id") ?? "";
  if (selectedStoreId) query.set("storeId", selectedStoreId);
  return apiRequest(`/api/marketplace/finance/wildberries?${query.toString()}`);
}


export interface OzonFinanceReport {
  dashboard?:{revenue:number|null;expenses:number|null;commission:number|null;logistics:number|null;other:number|null};
  marketplace: "ozon";
  currency: string | null;
  from: string;
  to: string;
  soldItems: Array<{ sellerSku: string; externalProductId: string; quantity: number }>;
  catalogCost?: { matchedUnits: number; unmatchedUnits: number; costOfGoods: number };
  productSalesError?: string | null;
  productSalesMetric?: "ordered_units" | null;
  totals: {
    accrued: number;
    posting: number;
    item: number;
    nonItem: number;
    containerFees: number;
    other: number;
    accrualsCount: number;
    missingAmountRows: number;
  };
}

export function getOzonFinanceReport(
  from: string,
  to: string,
): Promise<OzonFinanceReport> {
  const query = new URLSearchParams({ from, to });
  const selectedStoreId = localStorage.getItem("navigator-active-store-id") ?? "";
  if (selectedStoreId) query.set("storeId", selectedStoreId);
  return apiRequest(`/api/marketplace/finance/ozon?${query.toString()}`);
}

export interface SellerExpense {
  id: string;
  expenseDate: string;
  category: string;
  description: string;
  amount: string;
  currency: string;
}

export interface SellerExpensesReport {
  expenses: SellerExpense[];
  total: number;
  from: string;
  to: string;
}

export function getSellerExpenses(from: string, to: string): Promise<SellerExpensesReport> {
  const query = new URLSearchParams({ from, to });
  return apiRequest(`/api/marketplace/finance/expenses?${query.toString()}`);
}

export function createSellerExpense(input: { expenseDate: string; category: string; description?: string; amount: string }): Promise<SellerExpense> {
  return apiRequest("/api/marketplace/finance/expenses", { method: "POST", body: JSON.stringify(input) });
}

export function deleteSellerExpense(id: string): Promise<void> {
  return apiRequest(`/api/marketplace/finance/expenses/${id}`, { method: "DELETE" });
}

export function updateOzonPerformance(storeId: number, credentials: { clientId: string; clientSecret: string }): Promise<{ connected: boolean }> {
  return apiRequest(`/api/marketplace/stores/${storeId}/ozon-performance`, { method: "PUT", body: JSON.stringify(credentials) });
}
