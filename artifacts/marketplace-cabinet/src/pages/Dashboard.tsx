import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Activity, Bot, ChevronDown, ChevronUp, CircleHelp, DollarSign,
  RefreshCw, Send, ShoppingCart, Package, Wallet, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { formatMoney, formatNumber } from "@/lib/format";
import {
  formatApiError, getMarketplaceConnections, getMarketplaceDashboard,
} from "@/lib/marketplace-api";
import type {
  MarketplaceConnection, MarketplaceDashboard, MarketplaceFilter, MarketplacePeriod,
} from "@/lib/marketplace-api";
import "./dashboard-approved.css";

const PERIODS: Array<{ key: MarketplacePeriod; label: string }> = [
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "90d", label: "90 дней" },
];
const FINANCE_ITEMS = [
  { key: "margin", label: "Маржа", note: "Потребуются отчёты о реализации и себестоимости" },
  { key: "profitability", label: "Рентабельность", note: "Рассчитывается после подтверждения формулы маржи" },
  { key: "revenue", label: "Выручка", note: "Будет рассчитана по финансовым отчётам площадок" },
  { key: "expenses", label: "Расходы", note: "Комиссии, логистика, хранение и услуги" },
  { key: "cost", label: "Себестоимость", note: "Нужна загрузка себестоимости товаров" },
  { key: "ads", label: "Реклама", note: "Нужны рекламные отчёты площадок" },
  { key: "extra", label: "Доп. расходы", note: "Настраиваемые расходы продавца" },
] as const;

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
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "assistant" | "user"; text: string }>>([
    { role: "assistant", text: "Здравствуйте! Я помогу разобраться с показателями ваших магазинов. Сейчас ответы доступны в демонстрационном режиме." },
  ]);

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
    name: marketLabel(item.marketplace),
    marketplace: item.marketplace,
    orders: item.orders,
  })), [data]);
  const kpis = [
    { label: "Выручка", value: formatMoney(data?.revenue ?? 0), icon: DollarSign },
    { label: "Заказы", value: formatNumber(data?.orders ?? 0), icon: ShoppingCart },
    { label: "Проданные единицы", value: formatNumber(data?.units ?? 0), icon: Package },
    { label: "Средний чек", value: data && data.averageOrderValue > 0 ? formatMoney(data.averageOrderValue) : "—", icon: Wallet },
  ];

  function toggleFinance(key: string) {
    setExpandedFinance((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }
  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = chatInput.trim();
    if (!question) return;
    setMessages((current) => [
      ...current,
      { role: "user", text: question },
      { role: "assistant", text: "Демонстрационный режим: подключение модели ИИ ещё не выполнено. В рабочей версии ответ будет формироваться по данным выбранных магазинов и периода." },
    ]);
    setChatInput("");
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
                <YAxis tickFormatter={(value) => shortMoney(Number(value))} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(value) => formatNumber(Number(value))} />
                <Bar dataKey="orders" name="Заказы" radius={[6, 6, 0, 0]} fill="#2f7a6a" />
              </BarChart>
            </ResponsiveContainer> : <div className="approved-empty">Нет достоверной разбивки заказов по площадкам за выбранный период.</div>}
            <p className="approved-footnote">История заказов по дням пока не предоставляется всеми подключёнными API. Здесь не подставляются вымышленные значения.</p>
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
                <div><span>Заказы</span><strong>{formatNumber(funnel.orders)}</strong><small>{funnel.cartToOrderPercent.toFixed(1)}%</small></div>
                <div><span>Выкуплено</span><strong>{formatNumber(funnel.purchases)}</strong><small>{funnel.orderToPurchasePercent.toFixed(1)}%</small></div>
              </div>
            </article>)}
          </div> : <div className="approved-empty">Для выбранных площадок API пока не вернуло полный набор этапов воронки.</div>}
          <p className="approved-footnote">Показатели отображаются только там, где источник API предоставляет соответствующие метрики.</p>
        </section>

        <section className="approved-section">
          <div className="approved-section-heading">
            <div><h2>Сводка по финансам</h2><p>Ноябрь · блоки подготовлены под реальные финансовые отчёты</p></div>
            <button className="approved-collapse" onClick={() => setFinanceOpen((value) => !value)} aria-expanded={financeOpen}>{financeOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {financeOpen ? "Свернуть" : "Развернуть"}</button>
          </div>
          {financeOpen && <div className="approved-finance-grid">
            {FINANCE_ITEMS.map((item) => <article className="approved-finance-card" key={item.key}>
              <div className="approved-finance-head"><h3>{item.label}</h3><button aria-label={`Подробнее: ${item.label}`} onClick={() => toggleFinance(item.key)}>{expandedFinance.includes(item.key) ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button></div>
              <strong>—</strong>
              {expandedFinance.includes(item.key) && <p>{item.note}</p>}
            </article>)}
          </div>}
          <p className="approved-footnote">Финансовые суммы из переданного макета не перенесены в расчёты: они демонстрационные и не подтверждены API.</p>
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
            <button title="Новый чат" aria-label="Новый чат" onClick={() => setMessages([{ role: "assistant", text: "Новый диалог. В демонстрационном режиме я пока не подключён к модели ИИ." }])}><Activity size={16} /></button>
            <button title="Скрыть панель" aria-label="Скрыть панель" onClick={() => setChatOpen(false)}><X size={16} /></button>
          </div>
        </div>
        <div className="approved-assistant-sub">Помощник по вашим данным <span>ДЕМО</span></div>
        <div className="approved-chat-messages" aria-live="polite">
          {messages.map((message, index) => <div className={`approved-chat-message ${message.role}`} key={index}>
            {message.role === "assistant" && <small>ИИ-помощник</small>}{message.text}
          </div>)}
        </div>
        <div className="approved-chat-context"><CircleHelp size={14} /> {connected.length} подключённых площадок · {PERIODS.find((item) => item.key === period)?.label}</div>
        <form className="approved-chat-form" onSubmit={sendMessage}>
          <label htmlFor="approved-chat-input">Ваш вопрос</label>
          <div><textarea id="approved-chat-input" value={chatInput} onChange={(event) => setChatInput(event.target.value)} rows={3} maxLength={2000} placeholder="Спросите о ваших магазинах…" /><button aria-label="Отправить вопрос" type="submit" disabled={!chatInput.trim()}><Send size={16} /></button></div>
          <small>Ответы пока демонстрационные</small>
        </form>
      </aside>
      {!chatOpen && <button className="approved-assistant-open" onClick={() => setChatOpen(true)}><Bot size={16} /> ИИ-помощник</button>}
    </div>
  );
}
