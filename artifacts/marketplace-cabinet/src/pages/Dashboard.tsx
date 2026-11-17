import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "wouter";
import {
  Activity, Bot, ChevronDown, ChevronUp, CircleHelp, DollarSign,
  RefreshCw, Send, ShoppingCart, Package, Wallet, X, Trash2,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { formatMoney, formatNumber } from "@/lib/format";
import {
  formatApiError, getMarketplaceConnections, getMarketplaceDashboard,
  getAiAssistantConfig, sendAiAssistantMessage,
  getOzonFinanceReport, getWildberriesFinanceReport, getSellerExpenses,
  createSellerExpense, deleteSellerExpense,
} from "@/lib/marketplace-api";
import type {
  MarketplaceConnection, MarketplaceDashboard, MarketplaceFilter, MarketplacePeriod,
  OzonFinanceReport, WildberriesFinanceReport,
} from "@/lib/marketplace-api";
import "./dashboard-approved.css";

const PERIODS: Array<{ key: MarketplacePeriod; label: string }> = [
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "90d", label: "90 дней" },
];
const DERIVED_FINANCE_ITEMS = [
  { key: "margin", label: "Маржа", note: "Появится после сопоставления продаж с себестоимостью товаров" },
  { key: "profitability", label: "Рентабельность", note: "Рассчитывается на основе маржи и выручки" },
  { key: "cost", label: "Себестоимость проданного", note: "Нужна связь строк финансового отчёта с товарами каталога" },
  { key: "ads", label: "Реклама", note: "Загрузите рекламный отчёт площадки, чтобы учесть расходы на продвижение" },
] as const;

function previousFullWeek() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function shortMoney(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)} тыс.`;
  return String(Math.round(value));
}
function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);
}
function marketLabel(id: string) {
  return id === "ozon" ? "Ozon" : "Wildberries";
}
function MarketDot({ marketplace }: { marketplace: string }) {
  return <span className={`approved-market-dot ${marketplace}`} aria-hidden="true" />;
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<MarketplacePeriod>("30d");
  const [marketplace, setMarketplace] = useState<MarketplaceFilter>("all");
  const [data, setData] = useState<MarketplaceDashboard | null>(null);
  const [connections, setConnections] = useState<MarketplaceConnection[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [ordersOpen, setOrdersOpen] = useState(true);
  const [funnelOpen, setFunnelOpen] = useState(true);
  const [financeOpen, setFinanceOpen] = useState(true);
  const [expandedFinance, setExpandedFinance] = useState<string[]>([]);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financePeriod, setFinancePeriod] = useState(() => previousFullWeek());
  const [ozonFinance, setOzonFinance] = useState<OzonFinanceReport | null>(null);
  const [wildberriesFinance, setWildberriesFinance] = useState<WildberriesFinanceReport | null>(null);
  const [financeErrors, setFinanceErrors] = useState<string[]>([]);
  const [sellerExpenses, setSellerExpenses] = useState<Awaited<ReturnType<typeof getSellerExpenses>> | null>(null);
  const [expenseForm, setExpenseForm] = useState({ expenseDate: previousFullWeek().to, category: "Прочее", description: "", amount: "" });
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [aiConfig, setAiConfig] = useState<{ configured: boolean; model: string } | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "assistant" | "user"; text: string }>>([
    { role: "assistant", text: "Здравствуйте! Задайте вопрос о данных подключённых магазинов." },
  ]);

  useEffect(() => {
    void getAiAssistantConfig().then((config) => setAiConfig({ configured: config.configured, model: config.model }))
      .catch(() => setAiConfig({ configured: false, model: "" }));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      getMarketplaceDashboard(period, marketplace),
      getMarketplaceConnections(),
    ]).then(([dashboard, list]) => {
      if (!active) return;
      setData(dashboard);
      setConnections(list);
      setError("");
    }).catch((reason) => {
      if (active) {
        setData(null);
        setError(formatApiError(reason));
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, marketplace, refreshKey]);

  useEffect(() => {
    let active = true;
    const connectedMarketplaces = new Set(connections.filter((item) => item.connected).map((item) => item.marketplace));
    if (!connections.length) return;
    setFinanceLoading(true);
    setFinanceErrors([]);
    setOzonFinance(null);
    setWildberriesFinance(null);
    const jobs: Array<Promise<void>> = [];
    if (connectedMarketplaces.has("ozon") && (marketplace === "all" || marketplace === "ozon")) {
      jobs.push(getOzonFinanceReport(financePeriod.from, financePeriod.to).then((report) => {
        if (active) setOzonFinance(report);
      }).catch((error: unknown) => {
        if (active) setFinanceErrors((current) => [...current, `Ozon: ${formatApiError(error)}`]);
      }));
    } else setOzonFinance(null);
    if (connectedMarketplaces.has("wildberries") && (marketplace === "all" || marketplace === "wildberries")) {
      jobs.push(getWildberriesFinanceReport(financePeriod.from, financePeriod.to).then((report) => {
        if (active) setWildberriesFinance(report);
      }).catch((error: unknown) => {
        if (active) setFinanceErrors((current) => [...current, `Wildberries: ${formatApiError(error)}`]);
      }));
    } else setWildberriesFinance(null);
    jobs.push(getSellerExpenses(financePeriod.from, financePeriod.to).then((report) => {
      if (active) setSellerExpenses(report);
    }).catch((error: unknown) => {
      if (active) setFinanceErrors((current) => [...current, `Расходы продавца: ${formatApiError(error)}`]);
    }));
    void Promise.all(jobs).finally(() => { if (active) setFinanceLoading(false); });
    return () => { active = false; };
  }, [connections, financePeriod, marketplace, refreshKey]);

  async function addSellerExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!expenseForm.amount.trim() || expenseSaving) return;
    setExpenseSaving(true);
    try {
      await createSellerExpense(expenseForm);
      setExpenseForm((current) => ({ ...current, description: "", amount: "" }));
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setFinanceErrors((current) => [...current, `Расход продавца: ${formatApiError(error)}`]);
    } finally { setExpenseSaving(false); }
  }

  async function removeSellerExpense(id: string) {
    try {
      await deleteSellerExpense(id);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setFinanceErrors((current) => [...current, `Удаление расхода: ${formatApiError(error)}`]);
    }
  }

  const series = useMemo(() => (data?.salesSeries ?? []).slice(-14).map((item) => ({
    ...item,
    label: dateLabel(item.date),
  })), [data]);
  const connected = connections.filter((item) => item.connected);
  const revenueByMarket = useMemo(() => ({
    ozon: series.reduce((sum, day) => sum + day.ozonRevenue, 0),
    wildberries: series.reduce((sum, day) => sum + day.wildberriesRevenue, 0),
  }), [series]);
  const orderBars = useMemo(() => (data?.funnels ?? []).map((item) => ({
    name: item.marketplace === "ozon" ? "Ozon · ед. заказано" : marketLabel(item.marketplace),
    marketplace: item.marketplace,
    orders: item.orders,
  })), [data]);
  const kpis = [
    { label: "Выручка", value: formatMoney(data?.revenue ?? 0), icon: DollarSign },
    { label: "Заказы", value: formatNumber(data?.orders ?? 0), icon: ShoppingCart },
    { label: "Проданные единицы", value: formatNumber(data?.units ?? 0), icon: Package },
    { label: "Средний чек", value: data && data.averageOrderValue > 0 ? formatMoney(data.averageOrderValue) : "—", icon: Wallet },
  ];
  const wbCost = wildberriesFinance?.catalogCost;
  const wbCostComplete = Boolean(wildberriesFinance && wbCost && wildberriesFinance.soldItems.length > 0 && wbCost.unmatchedUnits === 0);
  const wbMargin = wbCostComplete && wildberriesFinance && wbCost
    ? wildberriesFinance.totals.sellerPayout - wbCost.costOfGoods
    : null;
  const manuallyTrackedAds = sellerExpenses?.expenses
    .filter((expense) => ["реклама", "продвижение", "ads"].includes(expense.category.trim().toLocaleLowerCase("ru-RU")))
    .reduce((sum, expense) => sum + Number(expense.amount), 0);

  function toggleFinance(key: string) {
    setExpandedFinance((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = chatInput.trim();
    if (!question || chatBusy) return;
    const conversation = [...messages, { role: "user" as const, text: question }];
    setMessages(conversation);
    setChatInput("");
    if (!aiConfig?.configured) {
      setMessages([...conversation, { role: "assistant", text: "ИИ-провайдер не настроен. Откройте Настройки → ИИ-помощник, сохраните Base URL, API-ключ и модель." }]);
      return;
    }
    const context = JSON.stringify({
      period,
      marketplace,
      totals: { revenue: data?.revenue ?? 0, orders: data?.orders ?? 0, units: data?.units ?? 0, averageOrderValue: data?.averageOrderValue ?? 0 },
      recentDailySales: data?.salesSeries.slice(-14) ?? [],
      funnels: data?.funnels ?? [],
      dataWarnings: data?.partialErrors ?? [],
    });
    setChatBusy(true);
    try {
      const result = await sendAiAssistantMessage(
        conversation.slice(-10).map((item) => ({ role: item.role, content: item.text })),
        context,
      );
      setMessages((current) => [...current, { role: "assistant", text: result.answer }]);
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", text: `Не удалось получить ответ: ${formatApiError(error)}` }]);
    } finally { setChatBusy(false); }
  }

  return (
    <div className={`approved-dashboard ${chatOpen ? "" : "chat-collapsed"}`}>
      <div className="approved-main">
        <header className="approved-header">
          <div>
            <div className="approved-title-row">
              <h1>Главная <span>(Дашборд)</span></h1>
              <span className="approved-demo-tag">Интерфейс в разработке</span>
            </div>
            <p>Единая картина продаж по подключённым маркетплейсам</p>
          </div>
          <div className="approved-toolbar">
            <label className="approved-filter">
              <span>Период</span>
              <select value={period} onChange={(event) => setPeriod(event.target.value as MarketplacePeriod)}>
                {PERIODS.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
              </select>
            </label>
            <label className="approved-filter">
              <span>Площадки</span>
              <select value={marketplace} onChange={(event) => setMarketplace(event.target.value as MarketplaceFilter)}>
                <option value="all">Все площадки</option>
                <option value="wildberries">Wildberries</option>
                <option value="ozon">Ozon</option>
              </select>
            </label>
            <button className="approved-button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>
              <RefreshCw size={15} className={loading ? "approved-spin" : ""} /> Обновить
            </button>
            <button className="approved-button approved-button-primary" onClick={() => setOrdersOpen((value) => !value)}>
              {ordersOpen ? "Свернуть блоки" : "Развернуть блоки"}
            </button>
          </div>
          <div className="approved-market-legend">
            <span><MarketDot marketplace="wildberries" /> Wildberries</span>
            <span><MarketDot marketplace="ozon" /> Ozon</span>
            <span className="approved-connection-count">{connected.length} из 2 площадок подключено</span>
          </div>
        </header>

        {error && <div className="approved-alert" role="alert">{error} <Link href="/settings">Открыть настройки API</Link></div>}
        {data?.partialErrors.map((item) => <div className="approved-alert approved-alert-muted" role="status" key={item}>{item}</div>)}

        <section className="approved-kpis" aria-label="Основные показатели">
          {kpis.map((item) => {
            const Icon = item.icon;
            return <article className="approved-kpi" key={item.label}>
              <div><span>{item.label}</span><strong>{loading ? "…" : item.value}</strong></div>
              <i><Icon size={19} /></i>
            </article>;
          })}
        </section>

        <section className="approved-panel">
          <div className="approved-panel-heading">
            <div><h2>Динамика выручки</h2><p>Ежедневные данные API · последние 14 точек выбранного периода</p></div>
            <span className="approved-source-tag">Данные API</span>
          </div>
          {series.length ? <div className="approved-chart">
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={series} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="approved-wb-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a02edd" stopOpacity={0.22} /><stop offset="100%" stopColor="#a02edd" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="approved-ozon-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#157bee" stopOpacity={0.18} /><stop offset="100%" stopColor="#157bee" stopOpacity={0.01} /></linearGradient>
                </defs>
                <CartesianGrid stroke="#e8efeb" strokeDasharray="4 5" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#73827b", fontSize: 11 }} minTickGap={18} />
                <YAxis tickFormatter={(value) => shortMoney(Number(value))} tickLine={false} axisLine={false} width={55} tick={{ fill: "#73827b", fontSize: 11 }} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} labelStyle={{ color: "#20372f" }} />
                {(marketplace === "all" || marketplace === "wildberries") && <Area type="monotone" dataKey="wildberriesRevenue" name="Wildberries" stroke="#a02edd" strokeWidth={2.4} fill="url(#approved-wb-fill)" />}
                {(marketplace === "all" || marketplace === "ozon") && <Area type="monotone" dataKey="ozonRevenue" name="Ozon" stroke="#157bee" strokeWidth={2.4} fill="url(#approved-ozon-fill)" />}
              </AreaChart>
            </ResponsiveContainer>
          </div> : <div className="approved-empty">{loading ? "Загружаем данные…" : "Пока нет данных. Подключите Wildberries или Ozon в настройках."}</div>}
        </section>

        <section className="approved-section">
          <div className="approved-section-heading">
            <div><h2>Заказы по площадкам</h2><p>Суммарные значения за выбранный период</p></div>
            <button className="approved-collapse" onClick={() => setOrdersOpen((value) => !value)} aria-expanded={ordersOpen}>{ordersOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {ordersOpen ? "Свернуть" : "Развернуть"}</button>
          </div>
          {ordersOpen && <div className="approved-panel">
            {orderBars.length ? <ResponsiveContainer width="100%" height={170}>
              <BarChart data={orderBars} margin={{ top: 12, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid stroke="#e8efeb" strokeDasharray="4 5" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => formatNumber(Number(value))} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(value, _name, item) => [formatNumber(Number(value)), item.payload.marketplace === "ozon" ? "Заказано, шт." : "Заказы"]} />
                <Bar dataKey="orders" name="Заказы / единицы" radius={[6, 6, 0, 0]} fill="#2f7a6a" />
              </BarChart>
            </ResponsiveContainer> : <div className="approved-empty">Нет достоверной разбивки заказов по площадкам за выбранный период.</div>}
            <p className="approved-footnote">WB показывает число заказов; Ozon — заказанные единицы товара. Значения подписаны отдельно, чтобы не смешивать заказы и штуки.</p>
          </div>}
        </section>

        <section className="approved-panel">
          <div className="approved-panel-heading">
            <div><h2>Воронка продаж</h2><p>Доступные агрегированные метрики маркетплейсов</p></div>
            <span className="approved-source-tag">Частично доступно</span>
          </div>
          {data?.funnels.length ? <div className="approved-funnel-grid">
            {data.funnels.map((funnel) => <article className="approved-funnel-card" key={funnel.marketplace}>
              <h3><MarketDot marketplace={funnel.marketplace} />{marketLabel(funnel.marketplace)}</h3>
              <div className="approved-funnel-stages">
                <div><span>Просмотры</span><strong>{formatNumber(funnel.views)}</strong></div>
                <div><span>Корзины</span><strong>{formatNumber(funnel.cartAdds)}</strong><small>{funnel.viewToCartPercent.toFixed(1)}%</small></div>
                <div><span>{funnel.marketplace === "ozon" ? "Заказано, шт." : "Заказы"}</span><strong>{formatNumber(funnel.orders)}</strong><small>{funnel.cartToOrderPercent.toFixed(1)}%</small></div>
                <div><span>{funnel.marketplace === "ozon" ? "Выкуплено · нет данных" : "Выкуплено"}</span><strong>{funnel.marketplace === "ozon" ? "—" : formatNumber(funnel.purchases)}</strong>{funnel.marketplace !== "ozon" && <small>{funnel.orderToPurchasePercent.toFixed(1)}%</small>}</div>
              </div>
            </article>)}
          </div> : <div className="approved-empty">Для выбранных площадок API пока не вернуло полный набор этапов воронки.</div>}
          <p className="approved-footnote">Показатели отображаются только там, где источник API предоставляет соответствующие метрики.</p>
        </section>

        <section className="approved-section">
          <div className="approved-section-heading">
            <div><h2>Сводка по финансам</h2><p>Финансовые отчёты за {dateLabel(financePeriod.from)}–{dateLabel(financePeriod.to)} · предыдущие 7 полных дней</p></div>
            <button className="approved-collapse" onClick={() => setFinanceOpen((value) => !value)} aria-expanded={financeOpen}>{financeOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {financeOpen ? "Свернуть" : "Развернуть"}</button>
          </div>
          {financeOpen && <>
            {financeErrors.map((item) => <div className="approved-alert approved-alert-muted" role="status" key={item}>{item}</div>)}
            <div className="approved-finance-grid">
              {ozonFinance && <article className="approved-finance-card approved-finance-report">
                <div className="approved-finance-head"><h3><MarketDot marketplace="ozon" /> Ozon · начисления</h3><span>{financeLoading ? "Обновляем…" : `${ozonFinance.totals.accrualsCount} операций`}</span></div>
                <strong>{financeLoading ? "…" : formatMoney(ozonFinance.totals.accrued)}</strong>
                <div className="approved-finance-rows">
                  {[ ["Проводки", ozonFinance.totals.posting], ["Товарные операции", ozonFinance.totals.item], ["Нетоварные операции", ozonFinance.totals.nonItem], ["Контейнерные сборы", ozonFinance.totals.containerFees], ["Прочее", ozonFinance.totals.other] ].map(([label, amount]) => <div key={String(label)}><span>{label}</span><b>{formatMoney(Number(amount))}</b></div>)}
                </div>
                {ozonFinance.totals.missingAmountRows > 0 && <p>{ozonFinance.totals.missingAmountRows} операций без суммы пропущено.</p>}
              </article>}
              {wildberriesFinance && <article className="approved-finance-card approved-finance-report">
                <div className="approved-finance-head"><h3><MarketDot marketplace="wildberries" /> Wildberries · отчёт реализации</h3><span>{financeLoading ? "Обновляем…" : `${wildberriesFinance.rowsCount} строк`}</span></div>
                <strong>{financeLoading ? "…" : formatMoney(wildberriesFinance.totals.retailAmount)}</strong>
                <div className="approved-finance-rows">
                  {[ ["К выплате продавцу", wildberriesFinance.totals.sellerPayout], ["Вознаграждение WB", wildberriesFinance.totals.marketplaceReward], ["Логистика", wildberriesFinance.totals.delivery], ["Хранение", wildberriesFinance.totals.storage], ["Приёмка", wildberriesFinance.totals.acceptance], ["Штрафы", wildberriesFinance.totals.penalties], ["Удержания", wildberriesFinance.totals.deductions], ["Эквайринг", wildberriesFinance.totals.acquiring], ["Доп. выплаты", wildberriesFinance.totals.additionalPayments] ].map(([label, amount]) => <div key={String(label)}><span>{label}</span><b>{formatMoney(Number(amount))}</b></div>)}
                </div>
                {wildberriesFinance.incomplete && <p>Выведена только часть отчёта. Уточните период выгрузки.</p>}
              </article>}
              {!financeLoading && !ozonFinance && !wildberriesFinance && !financeErrors.length && <div className="approved-empty">Подключите площадку с доступом к финансовым отчётам.</div>}
              {DERIVED_FINANCE_ITEMS.map((item) => {
                const value = item.key === "cost" && wbCost && wildberriesFinance?.soldItems.length
                  ? formatMoney(wbCost.costOfGoods)
                  : item.key === "ads" && manuallyTrackedAds !== undefined
                    ? formatMoney(manuallyTrackedAds)
                  : item.key === "margin" && wbMargin !== null
                    ? formatMoney(wbMargin)
                    : item.key === "profitability" && wbMargin !== null && (wildberriesFinance?.totals.sellerPayout ?? 0) !== 0
                      ? `${((wbMargin / wildberriesFinance!.totals.sellerPayout) * 100).toFixed(1)}%`
                      : "—";
                const note = item.key === "cost" && wbCost && wildberriesFinance?.soldItems.length
                  ? `Wildberries: учтено ${formatNumber(wbCost.matchedUnits)} шт.${wbCost.unmatchedUnits ? `, без сопоставления ${formatNumber(wbCost.unmatchedUnits)} шт.` : ""}.`
                  : item.key === "ads" && manuallyTrackedAds !== undefined
                    ? "Сумма из расходов продавца с категорией «Реклама» или «Продвижение». Добавляйте рекламные траты в форме ниже."
                  : item.key === "margin" && wbMargin !== null
                    ? "Wildberries: к выплате продавцу минус себестоимость. Дополнительные расходы и реклама сюда не включены."
                    : item.key === "profitability" && wbMargin !== null
                      ? "Wildberries: маржа разделена на сумму к выплате продавцу."
                      : item.note;
                return <article className="approved-finance-card" key={item.key}>
                  <div className="approved-finance-head"><h3>{item.label}</h3><button aria-label={`Подробнее: ${item.label}`} onClick={() => toggleFinance(item.key)}>{expandedFinance.includes(item.key) ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div>
                  <strong className={value === "—" ? "" : "approved-finance-value"}>{value}</strong>
                  {expandedFinance.includes(item.key) && <p>{note}</p>}
                </article>;
              })}
              <article className="approved-finance-card approved-expenses-card">
                <div className="approved-finance-head"><h3>Дополнительные расходы продавца</h3><span>{sellerExpenses ? `${sellerExpenses.expenses.length} записей` : ""}</span></div>
                <strong>{sellerExpenses ? formatMoney(sellerExpenses.total) : financeLoading ? "…" : "0 ₽"}</strong>
                <form className="approved-expense-form" onSubmit={addSellerExpense}>
                  <label>Дата<input type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm((current) => ({ ...current, expenseDate: event.target.value }))} required /></label>
                  <label>Категория<input value={expenseForm.category} onChange={(event) => setExpenseForm((current) => ({ ...current, category: event.target.value }))} maxLength={80} placeholder="Например, упаковка" required /></label>
                  <label>Описание<input value={expenseForm.description} onChange={(event) => setExpenseForm((current) => ({ ...current, description: event.target.value }))} maxLength={300} placeholder="Необязательно" /></label>
                  <label>Сумма, ₽<input inputMode="decimal" value={expenseForm.amount} onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0,00" required /></label>
                  <button type="submit" disabled={expenseSaving || !expenseForm.amount.trim()}>{expenseSaving ? "Сохраняем…" : "Добавить расход"}</button>
                </form>
                {!!sellerExpenses?.expenses.length && <div className="approved-expense-list">
                  {sellerExpenses.expenses.map((expense) => <div key={expense.id}>
                    <span><b>{expense.category}</b>{expense.description && ` · ${expense.description}`}<small>{dateLabel(expense.expenseDate)}</small></span>
                    <strong>{formatMoney(Number(expense.amount))}</strong>
                    <button type="button" aria-label={`Удалить расход ${expense.category}`} title="Удалить расход" onClick={() => void removeSellerExpense(expense.id)}><Trash2 size={14} /></button>
                  </div>)}
                </div>}
                <p>Сумма показана за выбранные 7 дней. Эти расходы будут вычитаться при расчёте прибыли.</p>
              </article>
            </div>
          </>}
          <p className="approved-footnote">Показаны суммы из отчётов площадок; категории Ozon и WB различаются и не складываются в общие расходы. Себестоимость и маржа появятся после сопоставления строк продаж с товарами каталога. Реклама учитывается по отдельному отчёту площадки.</p>
        </section>

        <section className="approved-section">
          <div className="approved-section-heading">
            <div><h2>По магазинам</h2><p>Подключённые кабинеты и фактическая выручка</p></div>
            <Link href="/marketplaces" className="approved-text-link">Управление площадками →</Link>
          </div>
          <div className="approved-stores">
            {connections.map((connection) => {
              const amount = revenueByMarket[connection.marketplace];
              return <article className="approved-store-card" key={connection.marketplace}>
                <div className="approved-store-title"><MarketDot marketplace={connection.marketplace} /><div><h3>{connection.storeName || marketLabel(connection.marketplace)}</h3><span>{marketLabel(connection.marketplace)}</span></div><span className={connection.connected ? "approved-status connected" : "approved-status"}>{connection.connected ? "Подключено" : "Не подключено"}</span></div>
                <div className="approved-store-revenue"><span>Выручка за выбранный отрезок графика</span><strong>{connection.connected ? formatMoney(amount) : "—"}</strong></div>
                <div className="approved-store-bottom"><span>Последняя синхронизация</span><span>{connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString("ru-RU") : "Нет данных"}</span></div>
                {!connection.connected && <Link href="/settings" className="approved-text-link">Подключить API →</Link>}
              </article>;
            })}
          </div>
        </section>

        <footer className="approved-footer">Навигатор продаж <span>Данные берутся из подключённых API. Недоступные показатели не подменяются демонстрационными цифрами.</span></footer>
      </div>

      <aside className="approved-assistant">
        <div className="approved-assistant-head">
          <div><Bot size={18} /><strong>ИИ-помощник</strong></div>
          <div className="approved-assistant-actions">
            <button title="Новый чат" aria-label="Новый чат" onClick={() => setMessages([{ role: "assistant", text: "Новый диалог. Задайте вопрос о данных подключённых магазинов." }])} disabled={chatBusy}><Activity size={16} /></button>
            <button title="Скрыть панель" aria-label="Скрыть панель" onClick={() => setChatOpen(false)}><X size={16} /></button>
          </div>
        </div>
        <div className="approved-assistant-sub">Помощник по вашим данным <span>{aiConfig === null ? "…" : aiConfig.configured ? aiConfig.model : "НЕ НАСТРОЕН"}</span></div>
        <div className="approved-chat-messages" aria-live="polite">
          {messages.map((message, index) => <div className={`approved-chat-message ${message.role}`} key={index}>
            {message.role === "assistant" && <small>ИИ-помощник</small>}{message.text}
          </div>)}
          {chatBusy && <div className="approved-chat-message assistant"><small>ИИ-помощник</small>Формирую ответ…</div>}
        </div>
        <div className="approved-chat-context"><CircleHelp size={14} /> {connected.length} подключённых площадок · {PERIODS.find((item) => item.key === period)?.label}</div>
        <form className="approved-chat-form" onSubmit={sendMessage}>
          <label htmlFor="approved-chat-input">Ваш вопрос</label>
          <div><textarea id="approved-chat-input" value={chatInput} onChange={(event) => setChatInput(event.target.value)} rows={3} maxLength={2000} placeholder="Спросите о ваших магазинах…" disabled={chatBusy} /><button aria-label="Отправить вопрос" type="submit" disabled={!chatInput.trim() || chatBusy}><Send size={16} /></button></div>
          <small>{aiConfig?.configured ? `Модель: ${aiConfig.model}` : "Подключите модель в Настройки → ИИ-помощник"}</small>
        </form>
      </aside>
      {!chatOpen && <button className="approved-assistant-open" onClick={() => setChatOpen(true)}><Bot size={16} /> ИИ-помощник</button>}
    </div>
  );
}
