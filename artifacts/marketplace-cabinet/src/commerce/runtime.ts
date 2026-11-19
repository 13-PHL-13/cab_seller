import { workspaceRequest as request } from "@/lib/collaboration-api";
export type State = Record<string, any>;
export interface CommerceBootstrap {
  companyId: string;
  states: Record<string, { state: State; revision: number }>;
  records: State[];
  stores: Array<{ id: string; name: string; platform: string }>;
  listings: State[];
  updatedAt: string;
  permissions: { edit: boolean; approve: boolean; allStores: boolean };
  notice: string;
}
export interface CommerceRuntime {
  scopedKey: (key: string) => string;
  readScoped: (key: string) => string | null;
  currentCompany: () => { id: string; name: string };
  sessionStores: () => CommerceBootstrap["stores"];
  permitted: (name: string) => boolean;
  hasFinance: () => boolean;
  permission: (name: string) => boolean;
  persist: (kind: string, state: State) => void;
  getPreviousDashboardFinance: (market: string) => State;
  getUnitSnapshot: () => State;
  dispose: () => void;
  loadFinance: () => Promise<void>;
}
export function makeRuntime(
  boot: CommerceBootstrap,
  companyName: string,
  onStatus: (text: string, error?: boolean) => void,
): CommerceRuntime {
  const empty = {
    version: 2,
    scope: "all",
    records: boot.records,
    rows: [],
    customColumns: [],
    costPools: Object.fromEntries(
      ["labels", "bags", "fulfillment", "delivery"].map((k) => [
        k,
        { total: 0, mode: "quantity" },
      ]),
    ),
    approvals: [],
  };
  const values: Record<string, State> = {
    costs: boot.states.costs?.state ?? empty,
    unit: boot.states.unit?.state ?? {
      version: 1,
      links: {},
      settings: {},
      columns: [],
    },
  };
  const revisions: Record<string, number> = {
    costs: boot.states.costs?.revision ?? 0,
    unit: boot.states.unit?.revision ?? 0,
  };
  const pending = new Map<string, State>();
  let running = false,
    failed = false,
    disposed = false;
  const notify = (text: string, error = false) => {
    if (!disposed) onStatus(text, error);
  };
  async function flush() {
    if (running || failed) return;
    running = true;
    try {
      while (pending.size) {
        const [kind, state] = pending.entries().next().value!;
        pending.delete(kind);
        const result = await request<{ revision: number }>(
          `/api/commerce/${kind}`,
          {
            method: "PUT",
            body: JSON.stringify({ revision: revisions[kind], state }),
          },
        );
        revisions[kind] = result.revision;
      }
      notify("Изменения сохранены на сервере");
    } catch (e) {
      failed = true;
      notify((e as Error).message, true);
    } finally {
      running = false;
    }
  }
  const now = new Date(Date.now() + 5 * 3600000),
    last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    period = last.toISOString().slice(0, 7),
    periodLabel = last.toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const finance: Record<string, State> = Object.fromEntries(
    ["wb", "ozon"].map((m) => [
      m,
      {
        period,
        periodLabel,
        payouts: null,
        revenue: null,
        ready: false,
        message: "Ожидаем выплаты и выручку за полный предыдущий месяц.",
        source: "API площадки",
      },
    ]),
  );
  return {
    scopedKey: (k) => k,
    readScoped: (k) =>
      JSON.stringify(values[k.includes("unit-economics") ? "unit" : "costs"]),
    currentCompany: () => ({ id: boot.companyId, name: companyName }),
    sessionStores: () => boot.stores,
    permitted: () => true,
    hasFinance: () => true,
    permission: (n) =>
      n === "approvePrices" ? boot.permissions.approve : boot.permissions.edit,
    persist: (kind, state) => {
      if (failed)
        throw Error(
          "Сохранение остановлено после ошибки. Сохраните введённые значения и обновите страницу.",
        );
      values[kind] = structuredClone(state);
      pending.set(kind, values[kind]);
      notify("Сохраняем изменения…");
      void flush();
    },
    getPreviousDashboardFinance: (m) => finance[m],
    getUnitSnapshot: () => ({
      listings: boot.listings,
      operations: [],
      source: "api",
      complete: false,
      updatedAt: boot.updatedAt,
      notice: boot.notice,
    }),
    dispose: () => {
      disposed = true;
    },
    loadFinance: async () => {
      try {
        const response = await request<{
          from: string;
          sources: Record<
            string,
            { revenue?: number; payout?: number; error?: string } | null
          >;
        }>("/api/cogs/min-prices");
        for (const [m, target] of [
          ["wb", "wildberries"],
          ["ozon", "ozon"],
        ]) {
          const s = response.sources[target];
          const ready =
            !!s &&
            !s.error &&
            typeof s.revenue === "number" &&
            s.revenue > 0 &&
            typeof s.payout === "number" &&
            s.payout > 0 &&
            s.payout <= s.revenue;
          finance[m] = {
            ...finance[m],
            period: response.from.slice(0, 7),
            ready,
            payouts: ready ? s!.payout : null,
            revenue: ready ? s!.revenue : null,
            message:
              s?.error ??
              (ready
                ? "Выплаты и выручка за полный предыдущий месяц."
                : "Нет корректных финансовых данных за полный предыдущий месяц."),
          };
        }
        if (!disposed)
          document.dispatchEvent(new CustomEvent("dashboard-finance-updated"));
      } catch (e) {
        if (!disposed) notify((e as Error).message, true);
      }
    },
  };
}
