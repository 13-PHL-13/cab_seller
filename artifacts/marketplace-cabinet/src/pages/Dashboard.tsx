import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearch } from "wouter";
import { ArrowUp, ChevronDown, ClipboardPen, Sparkles } from "lucide-react";
import {
  getMarketplaceStores,
  type MarketplaceStore,
  type WildberriesFinanceReport,
  type SellerExpensesReport,
} from "@/lib/marketplace-api";
import { workspaceRequest as request } from "@/lib/collaboration-api";
import { getDashboardWindow } from "@/lib/dashboard-api";
import {
  completeSum,
  calendarDays,
  money,
  quantity,
  type BlockContext,
  type DashboardMetric,
  type DashboardPoint,
  type DashboardStore,
  type DashboardWindow,
} from "@/lib/dashboard-model";
import { captureDashboardBlock } from "@/lib/dashboard-snapshot";
import { useCollaboration } from "@/components/CollaborationProvider";
import { useAiWorkspace } from "@/components/AiWorkspace";
import DashboardChart, {
  Change,
  type ChartSeries,
} from "@/components/DashboardChart";
import "./dashboard-prototype.css";
const platformName = (platform: string) =>
  platform === "ozon" ? "Ozon" : "ВБ";
const platformClass = (platform: string) =>
  platform === "ozon" ? "ozon" : "wb";
const platformColor = (platform: string) =>
  platform === "ozon" ? "#157bee" : "#a02edd";
const keys: DashboardMetric[] = [
  "views",
  "carts",
  "orders",
  "bought",
  "orderAmount",
  "boughtAmount",
];
const metricLabels = [
  ["margin", "Маржа"],
  ["profitability", "Рентабельность"],
  ["revenue", "Выручка"],
  ["expenses", "Расходы"],
  ["cost", "Себестоимость"],
  ["ads", "Реклама"],
  ["extra", "Доп. расходы"],
] as const;
type FinanceKey = (typeof metricLabels)[number][0];
type Finance = Record<FinanceKey, number | null>;
const blankFinance = (): Finance => ({
  margin: null,
  profitability: null,
  revenue: null,
  expenses: null,
  cost: null,
  ads: null,
  extra: null,
});
function localToday() {
  return new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
}
function fallbackWindow() {
  const to = localToday(),
    from = new Date(Date.parse(to + "T00:00:00Z") - 13 * 86400000)
      .toISOString()
      .slice(0, 10);
  return { from, to, stores: [], partialErrors: [] } as DashboardWindow;
}
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00Z").toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
function datesLabel(window: DashboardWindow) {
  return dateLabel(window.from) + " — " + dateLabel(window.to);
}
function Market({ platform }: { platform: string }) {
  return (
    <span className="market-name">
      <span className={"market-dot " + platformClass(platform)} />
      {platformName(platform)}
    </span>
  );
}
function Toggle({
  open,
  onClick,
  label,
  primary = false,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={"toggle " + (primary ? "primary" : "")}
      aria-expanded={open}
      aria-label={`${open ? "Свернуть" : "Развернуть"} ${label}`}
      onClick={onClick}
    >
      <span>{open ? "Свернуть" : "Развернуть"}</span>
      <ChevronDown className="chevron" size={15} />
    </button>
  );
}
function sumMetric(
  stores: MarketplaceStore[],
  window: DashboardWindow | undefined,
  key: DashboardMetric,
) {
  return completeSum(
    stores.map(
      (store) =>
        window?.stores.find((s) => s.id === store.id)?.data.totals[key],
    ),
  );
}
function dayPoints(
  stores: MarketplaceStore[],
  window: DashboardWindow | undefined,
  dates: string[],
): DashboardPoint[] {
  return dates.map(
    (date) =>
      Object.fromEntries([
        ["date", date],
        ...keys.map((key) => [
          key,
          completeSum(
            stores.map(
              (store) =>
                window?.stores
                  .find((s) => s.id === store.id)
                  ?.data.daily.find((p) => p.date === date)?.[key],
            ),
          ),
        ]),
      ]) as DashboardPoint,
  );
}
function FinanceValue({
  value,
  percent = false,
}: {
  value: number | null;
  percent?: boolean;
}) {
  return (
    <strong>
      {percent
        ? value === null
          ? "Нет данных"
          : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%"
        : money(value)}
    </strong>
  );
}
function Summary({
  stores,
  window,
  previous,
  current,
  kind,
}: {
  stores: MarketplaceStore[];
  window: DashboardWindow;
  previous?: DashboardWindow;
  current?: DashboardWindow;
  kind: "orders" | "bought";
}) {
  const today = current?.to;
  const daily = dayPoints(
    stores,
    current,
    today
      ? [
          today,
          new Date(Date.parse(today + "T00:00:00Z") - 86400000)
            .toISOString()
            .slice(0, 10),
        ]
      : [],
  );
  return (
    <div className="commerce-summary">
      {[
        [kind, kind === "orders" ? "Заказано" : "Выкуплено"],
        [kind === "orders" ? "orderAmount" : "boughtAmount", "Сумма"],
        ["margin", "Маржа"],
      ].map(([key, label]) => {
        const metric = key as DashboardMetric,
          amount = key.includes("Amount") || key === "margin",
          formatter = amount ? money : quantity;
        return (
          <div className="commerce-metric" key={key}>
            <span className="metric-caption">{label}</span>
            <div className="metric-periods">
              <div>
                <span>2 недели</span>
                <span>
                  <strong>
                    {formatter(sumMetric(stores, window, metric))}
                  </strong>{" "}
                  <Change
                    value={sumMetric(stores, window, metric)}
                    previous={sumMetric(stores, previous, metric)}
                  />
                </span>
              </div>
              <div>
                <span>Сегодня</span>
                <span>
                  <strong>{formatter(daily[0]?.[metric] ?? null)}</strong>{" "}
                  <Change
                    value={daily[0]?.[metric] ?? null}
                    previous={daily[1]?.[metric] ?? null}
                  />
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function Block({
  id,
  title,
  stores,
  period,
  sourceData,
  toggle,
  children,
  small = false,
  financeCard = false,
  marketplace,
  headerUnits,
  headerSummary,
}: {
  id: string;
  title: string;
  stores: MarketplaceStore[];
  period: string;
  sourceData: unknown;
  toggle?: ReactNode;
  children: ReactNode;
  small?: boolean;
  financeCard?: boolean;
  marketplace?: string;
  headerUnits?: ReactNode;
  headerSummary?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null),
    { createTask, canCreate, workspace } = useCollaboration(),
    ai = useAiWorkspace(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const member = workspace?.members.find(
      (m) => m.userId === workspace.currentUserId,
    ),
    finance =
      workspace?.role === "owner" ||
      workspace?.role === "admin" ||
      member?.canSeeFinance;
  const storeText =
    stores
      .map((s) => `${s.storeName} · ${platformName(s.marketplace)}`)
      .join(", ") || "Нет подключённых магазинов";
  const context: BlockContext = {
    section: title,
    stores: storeText,
    period,
    storeIds: stores.map((s) => String(s.id)),
    reference:
      "/?" +
      new URLSearchParams({
        block: id,
        store: stores.length === 1 ? String(stores[0].id) : "",
        platform:
          stores.length &&
          stores.every((s) => s.marketplace === stores[0].marketplace)
            ? stores[0].marketplace
            : "all",
      }).toString(),
  };
  async function task() {
    if (!ref.current) return;
    setError("");
    setBusy(true);
    try {
      const image = await captureDashboardBlock(ref.current);
      createTask({ ...context, image });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id={id}
      ref={ref}
      className={
        small
          ? "store-panel"
          : financeCard
            ? "finance-card"
            : "chart-card aggregate"
      }
    >
      <div
        className={
          small
            ? "store-panel-heading"
            : financeCard
              ? "finance-card-head"
              : marketplace
                ? "platform-heading"
                : "chart-heading"
        }
      >
        <div className="chart-title-stack">
          {small ? (
            <h4>{title}</h4>
          ) : financeCard ? (
            <h3>{title}</h3>
          ) : marketplace ? (
            <h3>
              <Market platform={marketplace} />
            </h3>
          ) : (
            <h2>{title}</h2>
          )}
          {headerUnits}
        </div>
        {headerSummary && <div className="orders-metrics">{headerSummary}</div>}
        <div className="task-heading-actions">
          {toggle}
          {finance && (
            <div className="analytics-action-row">
              {canCreate && (
                <button
                  type="button"
                  className="task-from-analytics"
                  disabled={busy}
                  onClick={() => void task()}
                >
                  <ClipboardPen size={16} />
                  <span>Поручить</span>
                </button>
              )}
              {ai.allowed && (
                <button
                  type="button"
                  className="ask-ai-button"
                  disabled={ai.busy}
                  onClick={() =>
                    void ai.openBlock(
                      JSON.stringify({
                        ...context,
                        data: sourceData,
                        at: new Date().toISOString(),
                        definitions:
                          "Пропущенные значения обозначены null. Это отсутствие данных, а не нулевые показатели.",
                      }),
                    )
                  }
                >
                  <Sparkles size={16} />
                  <span>Спросить ИИ</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </section>
  );
}
export default function DashboardPage() {
  const search = useSearch(),
    initial = new URLSearchParams(search);
  const [platform, setPlatform] = useState(initial.get("platform") ?? "all"),
    [store, setStore] = useState(
      initial.get("store") ??
        localStorage.getItem("navigator-active-store-id") ??
        "",
    ),
    [period, setPeriod] = useState<"current" | "previous">("current");
  const [stores, setStores] = useState<MarketplaceStore[]>([]),
    [windows, setWindows] = useState<{
      current?: DashboardWindow;
      previous?: DashboardWindow;
    }>({}),
    [loading, setLoading] = useState(true),
    [errors, setErrors] = useState<string[]>([]);
  const [groups, setGroups] = useState({
      orders: true,
      bought: true,
      funnel: true,
    }),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [financeOpen, setFinanceOpen] = useState<Set<string>>(
      new Set(metricLabels.map((m) => m[0])),
    ),
    [units, setUnits] = useState<Record<string, "count" | "money">>({});
  const [reports, setReports] = useState<
      Record<number, WildberriesFinanceReport>
    >({}),
    [extra, setExtra] = useState<number | null>(null),
    [financeErrors, setFinanceErrors] = useState<string[]>([]),
    [topVisible, setTopVisible] = useState(false),
    [fixed, setFixed] = useState(false),
    [controlRight, setControlRight] = useState(20);
  const root = useRef<HTMLDivElement>(null),
    anchor = useRef<HTMLDivElement>(null),
    { workspace } = useCollaboration(),
    ai = useAiWorkspace();
  const member = workspace?.members.find(
      (m) => m.userId === workspace.currentUserId,
    ),
    canFinance =
      workspace?.role === "owner" ||
      workspace?.role === "admin" ||
      !!member?.canSeeFinance;
  useEffect(() => {
    let active = true;
    void getMarketplaceStores()
      .then((result) => {
        if (active) {
          setStores(result.stores);
          if (store && !result.stores.some((s) => String(s.id) === store))
            setStore("");
        }
      })
      .catch((e) => {
        if (active) setErrors([e.message]);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.has("block")) {
      setPlatform(params.get("platform") ?? "all");
      setStore(params.get("store") ?? "");
      setTimeout(
        () =>
          document
            .getElementById(params.get("block") ?? "")
            ?.scrollIntoView({ block: "start", behavior: "smooth" }),
        100,
      );
    }
  }, [search]);
  const available = stores.filter(
      (s) => platform === "all" || s.marketplace === platform,
    ),
    selected = available.filter((s) => !store || String(s.id) === store),
    platforms = [...new Set(selected.map((s) => s.marketplace))];
  const companyMonth = localToday().slice(0, 7) + "-01",
    today = localToday(),
    chosen = windows[period] ?? fallbackWindow(),
    previous = period === "current" ? windows.previous : undefined,
    dates = calendarDays(chosen.from, chosen.to);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setWindows({});
    void Promise.allSettled([
      getDashboardWindow("current", platform, store),
      getDashboardWindow("previous", platform, store),
    ]).then((results) => {
      if (!active) return;
      const next: typeof windows = {},
        warnings: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          next[i === 0 ? "current" : "previous"] = r.value;
          warnings.push(...r.value.partialErrors);
        } else
          warnings.push(r.reason?.message ?? "Не удалось загрузить данные.");
      });
      setWindows(next);
      setErrors([...new Set(warnings)]);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [platform, store]);
  useEffect(() => {
    let active = true;
    setReports({});
    setExtra(null);
    setFinanceErrors([]);
    if (!canFinance || !stores.length) return;
    const wb = selected.filter((s) => s.marketplace === "wildberries");
    void Promise.allSettled(
      wb.map((s) =>
        request<WildberriesFinanceReport>(
          "/api/marketplace/finance/wildberries?" +
            new URLSearchParams({
              from: companyMonth,
              to: today,
              storeId: String(s.id),
            }),
        ),
      ),
    ).then((result) => {
      if (!active) return;
      const next: Record<number, WildberriesFinanceReport> = {},
        warnings: string[] = [];
      result.forEach((r, i) => {
        if (r.status === "fulfilled") next[wb[i].id] = r.value;
        else warnings.push(wb[i].storeName + ": " + r.reason.message);
      });
      setReports(next);
      setFinanceErrors(warnings);
    });
    if (platform === "all" && !store)
      void request<SellerExpensesReport>(
        "/api/marketplace/finance/expenses?" +
          new URLSearchParams({ from: companyMonth, to: today }),
      )
        .then((r) => {
          if (active) setExtra(r.total);
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [canFinance, stores, platform, store, companyMonth, today]);
  const finances = useMemo(
    () =>
      Object.fromEntries(
        selected.map((s) => {
          const result = blankFinance(),
            report = reports[s.id];
          if (report && !report.incomplete) {
            result.revenue = report.totals.retailAmount;
            result.expenses = completeSum([
              report.totals.marketplaceReward,
              report.totals.delivery,
              report.totals.storage,
              report.totals.acceptance,
              report.totals.penalties,
              report.totals.deductions,
              report.totals.acquiring,
            ]);
            if (
              report.catalogCost?.unmatchedUnits === 0 &&
              (report.soldItems.length > 0 || report.rowsCount === 0)
            )
              result.cost = report.catalogCost.costOfGoods;
          }
          return [s.id, result];
        }),
      ),
    [reports, selected.map((s) => s.id).join(",")],
  ) as Record<number, Finance>;
  const totals = Object.fromEntries(
    metricLabels.map(([key]) => [
      key,
      key === "extra"
        ? extra
        : completeSum(selected.map((s) => finances[s.id]?.[key])),
    ]),
  ) as Finance;
  useEffect(() => {
    ai.setAnalytics(
      JSON.stringify({
        section: "Главная (Дашборд)",
        stores: selected.map((s) => s.storeName).join(", "),
        period: datesLabel(chosen),
        data: chosen.stores,
        finances: canFinance ? totals : undefined,
        missingValues: "null означает отсутствие данных",
      }),
    );
  }, [windows, period, platform, store, reports, extra, canFinance]);
  useEffect(() => {
    const update = () => {
      const button = anchor.current?.querySelector("button");
      if (button && !anchor.current?.classList.contains("is-fixed")) {
        anchor.current?.style.setProperty(
          "--control-width",
          button.offsetWidth + "px",
        );
        anchor.current?.style.setProperty(
          "--control-height",
          button.offsetHeight + "px",
        );
      }
      setTopVisible(window.scrollY > 300);
      setFixed((anchor.current?.getBoundingClientRect().top ?? 0) < 12);
      setControlRight(
        Math.max(
          12,
          window.innerWidth -
            (root.current?.getBoundingClientRect().right ?? window.innerWidth),
        ),
      );
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    if (root.current) observer.observe(root.current);
    update();
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    let pending = false,
      lastWidth = 0;
    const element = root.current;
    if (!element) return;
    const fit = () => {
      pending = false;
      for (const block of element.querySelectorAll<HTMLElement>(
        ".metric-periods",
      )) {
        if (!block.getClientRects().length) continue;
        block.style.setProperty("--metric-scale", "1");
        let scale = 1;
        for (const row of [...block.children]) {
          const label = row.firstElementChild as HTMLElement,
            value = row.lastElementChild as HTMLElement;
          if (!label || !value) continue;
          const available = row.clientWidth - 8,
            needed = label.getBoundingClientRect().width + value.scrollWidth;
          if (needed > available) scale = Math.min(scale, available / needed);
        }
        block.style.setProperty(
          "--metric-scale",
          String(Math.max(0.55, Math.min(1, scale - 0.015))),
        );
      }
    };
    const schedule = () => {
      if (!pending) {
        pending = true;
        queueMicrotask(fit);
      }
    };
    const mutation = new MutationObserver(schedule);
    mutation.observe(element, { childList: true, subtree: true });
    const resize = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (Math.abs(width - lastWidth) > 0.5) {
        lastWidth = width;
        schedule();
      }
    });
    resize.observe(element);
    schedule();
    return () => {
      mutation.disconnect();
      resize.disconnect();
    };
  }, []);
  const toggleOne = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const anyExpanded =
    groups.orders || groups.bought || groups.funnel || financeOpen.size > 0;
  function toggleAll() {
    const next = !anyExpanded;
    let destination: string | undefined;
    if (!next && fixed) {
      const block = [
        ...root.current!.querySelectorAll<HTMLElement>(":scope > section"),
      ].find((el) => el.getBoundingClientRect().bottom > 96);
      destination = block?.dataset.primary ?? block?.id;
    }
    setGroups({ orders: next, bought: next, funnel: next });
    setCollapsed(new Set());
    setFinanceOpen(new Set(next ? metricLabels.map((m) => m[0]) : []));
    if (destination)
      requestAnimationFrame(() =>
        document
          .getElementById(destination!)
          ?.scrollIntoView({ block: "start" }),
      );
  }
  const unitControls = (id: string) => (
    <div className="chart-unit-bar">
      <div
        className="chart-unit-switch"
        role="group"
        aria-label={"Единицы графика " + id}
      >
        {(
          [
            ["count", "Штуки"],
            ["money", "Сумма, ₽"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={(units[id] ?? "count") === key}
            onClick={() => setUnits((u) => ({ ...u, [id]: key }))}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
  function chart(
    kind: "orders" | "bought" | "funnel",
    own: MarketplaceStore[],
    id: string,
    aggregate: boolean,
  ) {
    const currentPoints = dayPoints(own, chosen, dates),
      previousDates = previous
        ? calendarDays(previous.from, previous.to)
        : dates,
      previousPoints = dayPoints(own, previous, previousDates),
      unit = units[id] ?? "count",
      label =
        kind === "funnel"
          ? "Воронка продаж"
          : kind === "orders"
            ? "Заказы"
            : "Выкупы";
    const metrics: DashboardMetric[] =
      kind === "funnel"
        ? ["views", "carts", "orders", "bought"]
        : [
            unit === "money"
              ? kind === "orders"
                ? "orderAmount"
                : "boughtAmount"
              : kind,
          ];
    const colors = ["#d63dd0", "#8651d0", "#16a59c", "#4184d4"];
    const series: ChartSeries[] = metrics.flatMap((key, i) => [
      {
        key,
        label: key,
        color:
          kind === "funnel"
            ? colors[i]
            : aggregate
              ? "#2f7a6a"
              : platformColor(own[0]?.marketplace ?? ""),
        values: currentPoints.map((p) => p[key]),
        dash:
          kind === "funnel"
            ? i === 1
              ? "9 3"
              : i === 3
                ? "3 3"
                : undefined
            : undefined,
      },
      {
        key,
        label: "Предыдущий период",
        color: "#9baaa6",
        previous: true,
        values: previousPoints.map((p) => p[key]),
      },
    ]);
    return (
      <DashboardChart
        title={label}
        dates={dates}
        series={
          kind === "funnel" && aggregate
            ? series.filter((s) => !s.previous)
            : series
        }
        current={currentPoints}
        previous={previousPoints}
        unit={kind === "funnel" ? "count" : unit}
        bar={aggregate && kind !== "funnel"}
      />
    );
  }
  function funnelMetrics(own: MarketplaceStore[]) {
    const currentDay = windows.current?.to ?? today,
      yesterday = new Date(Date.parse(currentDay + "T00:00:00Z") - 86400000)
        .toISOString()
        .slice(0, 10),
      points = dayPoints(own, windows.current, [currentDay, yesterday]);
    return (
      <div className="platform-funnel-legend">
        {(
          [
            ["views", "Переходы"],
            ["carts", "Корзина"],
            ["orders", "Заказали"],
            ["bought", "Выкупили"],
          ] as const
        ).map(([key, label]) => (
          <span className="legend-item" key={key}>
            <span className={"stage-dot " + key} />
            {label}
            <div className="metric-periods">
              <div>
                <span>2 недели</span>
                <span>
                  <strong>{quantity(sumMetric(own, chosen, key))}</strong>{" "}
                  <Change
                    value={sumMetric(own, chosen, key)}
                    previous={sumMetric(own, previous, key)}
                  />
                </span>
              </div>
              <div>
                <span>Сегодня</span>
                <span>
                  <strong>
                    {quantity(
                      dayPoints(own, windows.current, [
                        windows.current?.to ?? today,
                      ])[0][key],
                    )}
                  </strong>
                  <Change value={points[0][key]} previous={points[1][key]} />
                </span>
              </div>
            </div>
          </span>
        ))}
      </div>
    );
  }
  const contextData = (own: MarketplaceStore[]) => ({
    from: chosen.from,
    to: chosen.to,
    stores: chosen.stores.filter((s) => own.some((o) => o.id === s.id)),
  });
  return (
    <div
      id="dashboard-view"
      className="prototype-dashboard"
      ref={root}
      tabIndex={-1}
      style={
        {
          "--dashboard-control-right": controlRight + "px",
        } as React.CSSProperties
      }
    >
      <header className="page-header">
        <div className="page-title">
          <h1>
            Главная <span>(Дашборд)</span>
          </h1>
        </div>
        <div className="toolbar">
          <div className="filters">
            <label className="filter">
              <span>Период графиков</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as typeof period)}
              >
                <option value="current">
                  {datesLabel(windows.current ?? fallbackWindow())}
                </option>
                <option value="previous">
                  {windows.previous
                    ? datesLabel(windows.previous)
                    : "Предыдущие 2 недели"}
                </option>
              </select>
            </label>
            <label className="filter">
              <span>Площадки</span>
              <select
                value={platform}
                onChange={(e) => {
                  setPlatform(e.target.value);
                  setStore("");
                  localStorage.removeItem("navigator-active-store-id");
                  window.dispatchEvent(new Event("dashboard-store-changed"));
                }}
              >
                <option value="all">Все площадки</option>
                {[...new Set(stores.map((s) => s.marketplace))].map((p) => (
                  <option key={p} value={p}>
                    {platformName(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter">
              <span>Магазины</span>
              <select
                value={store}
                onChange={(e) => {
                  setStore(e.target.value);
                  if (e.target.value)
                    localStorage.setItem(
                      "navigator-active-store-id",
                      e.target.value,
                    );
                  else localStorage.removeItem("navigator-active-store-id");
                  window.dispatchEvent(new Event("dashboard-store-changed"));
                }}
              >
                <option value="">Все магазины</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {platformName(s.marketplace)} · {s.storeName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            ref={anchor}
            className={"global-toggle-anchor " + (fixed ? "is-fixed" : "")}
          >
            <button
              id="global-toggle"
              type="button"
              className="toggle primary"
              onClick={toggleAll}
              aria-expanded={anyExpanded}
            >
              {anyExpanded ? "Свернуть всё" : "Развернуть всё"}
              <ChevronDown className="chevron" size={15} />
            </button>
          </div>
        </div>
        <div className="marketplace-key">
          {platforms.map((p) => (
            <Market key={p} platform={p} />
          ))}
        </div>
        {loading && (
          <p role="status">Загружаем данные подключённых магазинов…</p>
        )}
        {errors.map((error) => (
          <p className="dashboard-warning" role="status" key={error}>
            {error}
          </p>
        ))}
      </header>
      {!loading && !stores.length && (
        <div className="acc-empty">
          <h3>Начнём с магазина</h3>
          <p>Подключите магазин или попросите владельца открыть доступ.</p>
          <a href="/settings">Магазины и подключения →</a>
        </div>
      )}
      {(["orders", "bought"] as const).map((kind) => (
        <Fragment key={kind}>
          <Block
            id={kind + "-chart"}
            title={kind === "orders" ? "Заказы" : "Выкупы"}
            stores={selected}
            period={datesLabel(chosen)}
            sourceData={contextData(selected)}
            headerUnits={unitControls(kind + "-total")}
            headerSummary={
              <Summary
                stores={selected}
                window={chosen}
                previous={previous}
                current={windows.current}
                kind={kind}
              />
            }
          >
            {chart(kind, selected, kind + "-total", true)}
          </Block>
          <section className="breakdown-section" data-primary={kind + "-chart"}>
            <div className="section-heading">
              <h2>{kind === "orders" ? "Заказы" : "Выкупы"} по площадкам</h2>
              <Toggle
                open={groups[kind]}
                primary
                label={
                  "графики " +
                  (kind === "orders" ? "заказов" : "выкупов") +
                  " по площадкам"
                }
                onClick={() => {
                  setGroups((g) => ({ ...g, [kind]: !g[kind] }));
                  setCollapsed(
                    (c) =>
                      new Set([...c].filter((key) => !key.startsWith(kind))),
                  );
                }}
              />
            </div>
            {groups[kind] && (
              <div className="platform-charts">
                {platforms.map((p) => {
                  const own = selected.filter((s) => s.marketplace === p),
                    id = kind + "-" + p,
                    open = !collapsed.has(id);
                  return (
                    <Block
                      key={p}
                      id={id}
                      title={
                        (kind === "orders" ? "Заказы" : "Выкупы") +
                        " · " +
                        platformName(p)
                      }
                      stores={own}
                      period={datesLabel(chosen)}
                      sourceData={contextData(own)}
                      marketplace={p}
                      headerUnits={unitControls(id)}
                      toggle={
                        <Toggle
                          open={open}
                          label={
                            (kind === "orders" ? "заказы" : "выкупы") +
                            " " +
                            platformName(p)
                          }
                          onClick={() => toggleOne(id)}
                        />
                      }
                    >
                      <div className="platform-commerce">
                        <Summary
                          stores={own}
                          window={chosen}
                          previous={previous}
                          current={windows.current}
                          kind={kind}
                        />
                      </div>
                      {open && (
                        <>
                          <div className="comparison-legend">
                            <span className="legend-item">
                              <span
                                className={"legend-line " + platformClass(p)}
                              />
                              Текущий период
                            </span>
                            <span className="legend-item">
                              <span className="legend-line previous" />
                              Предыдущий период
                            </span>
                          </div>
                          {chart(kind, own, id, false)}
                        </>
                      )}
                    </Block>
                  );
                })}
              </div>
            )}
          </section>
        </Fragment>
      ))}
      <Block
        id="funnel-chart"
        title="Воронка продаж"
        stores={selected}
        period={datesLabel(chosen)}
        sourceData={contextData(selected)}
      >
        {funnelMetrics(selected)}
        {chart("funnel", selected, "funnel-total", true)}
      </Block>
      <section className="breakdown-section" data-primary="funnel-chart">
        <div className="section-heading">
          <h2>Воронки по площадкам</h2>
          <Toggle
            primary
            open={groups.funnel}
            label="воронки по площадкам"
            onClick={() => {
              setGroups((g) => ({ ...g, funnel: !g.funnel }));
              setCollapsed(
                (c) =>
                  new Set([...c].filter((key) => !key.startsWith("funnel"))),
              );
            }}
          />
        </div>
        {groups.funnel && (
          <div className="platform-charts">
            {platforms.map((p) => {
              const own = selected.filter((s) => s.marketplace === p),
                id = "funnel-" + p,
                open = !collapsed.has(id);
              return (
                <Block
                  id={id}
                  key={p}
                  title={"Воронка продаж · " + platformName(p)}
                  stores={own}
                  period={datesLabel(chosen)}
                  sourceData={contextData(own)}
                  marketplace={p}
                  toggle={
                    <Toggle
                      open={open}
                      label={"воронку " + platformName(p)}
                      onClick={() => toggleOne(id)}
                    />
                  }
                >
                  {open && (
                    <>
                      {funnelMetrics(own)}
                      {chart("funnel", own, id, false)}
                      <p className="platform-comparison">
                        Цветные линии — текущий период, серый пунктир —
                        предыдущий
                      </p>
                    </>
                  )}
                </Block>
              );
            })}
          </div>
        )}
      </section>
      {canFinance && (
        <>
          <section className="finance-section" id="finance-summary">
            <div className="section-heading">
              <div>
                <h2>Сводка по финансам</h2>
                <div className="month">
                  {new Date(today + "T12:00:00Z").toLocaleDateString("ru-RU", {
                    month: "long",
                    year: "numeric",
                  })}
                </div>
                <p className="month-note">*данные по текущему месяцу</p>
              </div>
              <Toggle
                primary
                open={financeOpen.size === 7}
                label="разбивки всех финансовых карточек"
                onClick={() =>
                  setFinanceOpen(
                    new Set(
                      financeOpen.size === 7
                        ? []
                        : metricLabels.map((m) => m[0]),
                    ),
                  )
                }
              />
            </div>
            {financeErrors.map((message) => (
              <p className="dashboard-warning" key={message}>
                {message}
              </p>
            ))}
            <div className="finance-grid">
              {metricLabels.map(([key, label]) => (
                <Block
                  id={"finance-" + key}
                  title={label}
                  stores={selected}
                  period={companyMonth + " — " + today}
                  sourceData={{
                    value: totals[key],
                    stores: selected.map((s) => ({
                      id: s.id,
                      value: finances[s.id]?.[key],
                    })),
                  }}
                  financeCard
                  key={key}
                  toggle={
                    <Toggle
                      open={financeOpen.has(key)}
                      label={label.toLowerCase() + " по площадкам"}
                      onClick={() =>
                        setFinanceOpen((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                    />
                  }
                >
                  {" "}
                  <div className="finance-value">
                    <FinanceValue
                      value={totals[key]}
                      percent={key === "profitability"}
                    />
                    <Change
                      value={totals[key]}
                      previous={null}
                      inverse={["expenses", "cost", "ads", "extra"].includes(
                        key,
                      )}
                    />
                  </div>
                  {financeOpen.has(key) && (
                    <div className="finance-breakdown">
                      {platforms.map((p) => (
                        <div className="finance-row" key={p}>
                          <Market platform={p} />
                          <div className="finance-market-values">
                            <FinanceValue
                              value={completeSum(
                                selected
                                  .filter((s) => s.marketplace === p)
                                  .map((s) => finances[s.id]?.[key]),
                              )}
                              percent={key === "profitability"}
                            />
                            <Change value={null} previous={null} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Block>
              ))}
            </div>
          </section>
          <section className="stores-section" id="stores-section">
            <div className="section-heading">
              <div>
                <h2>По магазинам</h2>
                <p className="month-note">
                  Подробно по каждому подключённому магазину
                </p>
              </div>
            </div>
            <div className="stores-list">
              {selected.map((s) => {
                const finance = finances[s.id] ?? blankFinance(),
                  report = reports[s.id],
                  expenses = [
                    ["Комиссия", report?.totals.marketplaceReward],
                    ["Логистика", report?.totals.delivery],
                    [
                      "Услуги",
                      report
                        ? completeSum([
                            report.totals.storage,
                            report.totals.acceptance,
                            report.totals.acquiring,
                          ])
                        : null,
                    ],
                    [
                      "Прочее",
                      report
                        ? completeSum([
                            report.totals.penalties,
                            report.totals.deductions,
                          ])
                        : null,
                    ],
                  ] as const;
                return (
                  <article className="store" key={s.id}>
                    <div className="store-title">
                      <span
                        className={"market-dot " + platformClass(s.marketplace)}
                      />
                      <h3>
                        {platformName(s.marketplace)}{" "}
                        <span className="store-name">— {s.storeName}</span>
                      </h3>
                    </div>
                    <div className="store-panels">
                      <Block
                        id={"store-" + s.id + "-revenue"}
                        title="Из чего складывается выручка"
                        stores={[s]}
                        period={companyMonth + " — " + today}
                        sourceData={finance}
                        small
                      >
                        <p className="store-revenue">
                          Выручка: <FinanceValue value={finance.revenue} />
                          <Change value={finance.revenue} previous={null} />
                        </p>
                        <Waterfall finance={finance} name={s.storeName} />
                        <div className="profitability">
                          <span>Рентабельность</span>
                          <FinanceValue value={finance.profitability} percent />
                        </div>
                      </Block>
                      <Block
                        id={"store-" + s.id + "-expenses"}
                        title="Расходы"
                        stores={[s]}
                        period={companyMonth + " — " + today}
                        sourceData={{
                          expenses: finance.expenses,
                          items: expenses,
                        }}
                        small
                      >
                        <div className="expenses-total">
                          <FinanceValue value={finance.expenses} />
                        </div>
                        {expenses.map(([label, raw]) => {
                          const value = raw ?? null,
                            share =
                              value !== null &&
                              finance.expenses !== null &&
                              finance.expenses > 0
                                ? (value / finance.expenses) * 100
                                : null;
                          return (
                            <div className="expense-item" key={label}>
                              <div className="expense-line">
                                <span>{label}</span>
                                <span className="expense-amount">
                                  <FinanceValue value={value} />
                                  <Change value={value} previous={null} />
                                  <small>
                                    Доля{" "}
                                    {share === null
                                      ? "Нет данных"
                                      : share.toLocaleString("ru-RU", {
                                          maximumFractionDigits: 1,
                                        }) + "%"}
                                  </small>
                                </span>
                              </div>
                              <div className="expense-progress">
                                {share !== null && (
                                  <span
                                    style={{
                                      width:
                                        Math.max(0, Math.min(100, share)) + "%",
                                      background: platformColor(s.marketplace),
                                    }}
                                  />
                                )}
                              </div>
                              {label === "Логистика" && (
                                <div className="logistics-detail">
                                  {[
                                    "Доставки покупателям",
                                    "Отмены и возвраты",
                                  ].map((title) => (
                                    <div className="logistics-row" key={title}>
                                      <span>{title}</span>
                                      <div>
                                        <strong>Нет данных</strong>
                                        <small>Доля: Нет данных</small>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </Block>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
      {topVisible && (
        <button
          className="dashboard-back-top"
          style={{ right: controlRight }}
          aria-label="Вернуться в начало страницы"
          onClick={() => {
            root.current?.focus({ preventScroll: true });
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "instant"
                : "smooth",
            });
          }}
        >
          <ArrowUp size={22} />
        </button>
      )}
    </div>
  );
}
function Waterfall({ finance, name }: { finance: Finance; name: string }) {
  const rows: [string, number | null][] = [
      ["Выручка", finance.revenue],
      ["Себестоимость", finance.cost],
      ["Расходы", finance.expenses],
      ["Реклама", finance.ads],
      ["Доп. расходы", finance.extra],
      ["Маржа", finance.margin],
    ],
    W = 640,
    H = 245,
    base = 190,
    peak = Math.max(1, ...rows.flatMap(([, v]) => (v === null ? [] : [v]))),
    y = (v: number) => base - (v / peak) * 155,
    complete = rows.every(([, v]) => v !== null);
  let cumulative = 0;
  return (
    <svg
      className="waterfall"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={"Из чего складывается выручка " + name}
    >
      <title>
        Структура выручки. Отсутствующие компоненты не рассчитываются.
      </title>
      {[0, 1, 2].map((k) => (
        <g key={k}>
          <line
            x1={63}
            x2={623}
            y1={y((peak * k) / 2)}
            y2={y((peak * k) / 2)}
            className="grid-line"
          />
          <text
            x={56}
            y={y((peak * k) / 2) + 4}
            textAnchor="end"
            className="waterfall-axis"
          >
            {quantity((peak * k) / 2)}
          </text>
        </g>
      ))}
      {rows.map(([label, value], i) => {
        const x = [105, 211, 302, 393, 484, 575][i],
          start = i === 0 ? 0 : cumulative;
        if (i > 0 && value !== null) cumulative += value;
        return (
          <g key={label}>
            {value !== null && (i === 0 || complete) && (
              <rect
                x={x - 24.5}
                y={y(start + value)}
                width={49}
                height={Math.max(0, (value / peak) * 155)}
                rx={4}
                fill={i === 0 ? "#2f7a6a" : i === 5 ? "#83af99" : "#c4d9cd"}
              />
            )}
            <text x={x} y={213} textAnchor="middle" className="waterfall-label">
              {label === "Себестоимость" ? "Себесто-" : label}
            </text>
            {label === "Себестоимость" && (
              <text
                x={x}
                y={227}
                textAnchor="middle"
                className="waterfall-label"
              >
                имость
              </text>
            )}
            <text
              x={x}
              y={
                value !== null && (i === 0 || complete)
                  ? y(start + value) - 8
                  : 95
              }
              textAnchor="middle"
              className="waterfall-value"
            >
              {value === null ? "Нет данных" : money(value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
