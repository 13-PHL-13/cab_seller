import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { ruRU } from '@clerk/localizations';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3,
  CircleHelp, Layers3, LockKeyhole, LogOut, RefreshCw, Settings2,
  ShieldCheck, ShoppingBag, ShoppingCart, Store, TrendingUp, Wallet,
} from 'lucide-react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  getGetMarketplaceDashboardQueryKey, getListMarketplaceConnectionsQueryKey,
  useConnectOzon, useConnectWildberries, useDisconnectMarketplace,
  useGetMarketplaceDashboard, useListMarketplaceConnections,
} from '@workspace/api-client-react';
import type { MarketplaceConnection, MarketplaceDashboard } from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22%3E%3Crect width=%2240%22 height=%2240%22 rx=%2211%22 fill=%22%23255d58%22/%3E%3Ctext x=%2220%22 y=%2227%22 text-anchor=%22middle%22 font-family=%22monospace%22 font-size=%2225%22 fill=%22%23f9f7ef%22%3E%D1%81.%3C/text%3E%3C/svg%3E',
  },
  variables: {
    colorPrimary: '#255d58',
    colorForeground: '#304744',
    colorMutedForeground: '#7b8983',
    colorDanger: '#a33e35',
    colorBackground: '#fcfbf7',
    colorInput: '#fffefa',
    colorInputForeground: '#354b47',
    colorNeutral: '#304744',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '0.65rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fcfbf7] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#304744] font-bold',
    headerSubtitle: 'text-[#7b8983]',
    socialButtonsBlockButtonText: 'text-[#304744]',
    formFieldLabel: 'text-[#304744]',
    footerActionLink: 'text-[#255d58]',
    footerActionText: 'text-[#7b8983]',
    dividerText: 'text-[#7b8983]',
    identityPreviewEditButton: 'text-[#255d58]',
    formFieldSuccessText: 'text-[#4b8069]',
    alertText: 'text-[#a33e35]',
    logoBox: 'mb-3',
    logoImage: 'max-h-9',
    socialButtonsBlockButton: 'border-[#dfe2d8] rounded-lg',
    formButtonPrimary: 'bg-[#255d58] rounded-lg',
    formFieldInput: 'border-[#dfe2d8] rounded-lg bg-[#fffefa]',
    footerAction: 'text-[#7b8983]',
    dividerLine: 'bg-[#e6e7df]',
    alert: 'bg-[#fff7f1] border-[#ebd4c9]',
    otpCodeFieldInput: 'border-[#dfe2d8] rounded-lg',
    formFieldRow: 'mb-4',
    main: 'gap-5',
  },
};

function Mark() {
  return <span className="brand-mark" aria-hidden="true">с.</span>;
}
function Brand({ link = true }: { link?: boolean }) {
  const inner = <><Mark /><span>сводка<small>кабинет продавца</small></span></>;
  return link ? <Link href="/" className="brand-lockup" data-testid="link-brand-home">{inner}</Link> : <div className="brand-lockup">{inner}</div>;
}

function Landing() {
  const [location] = useLocation();
  void location;
  const sample = useMemo(() => [
    { day: '01', ozon: 27, wb: 20 }, { day: '04', ozon: 43, wb: 31 },
    { day: '07', ozon: 34, wb: 51 }, { day: '10', ozon: 63, wb: 44 },
    { day: '13', ozon: 50, wb: 67 }, { day: '16', ozon: 76, wb: 58 },
    { day: '19', ozon: 64, wb: 79 }, { day: '22', ozon: 88, wb: 68 },
  ], []);
  return <main className="landing">
    <nav className="landing-nav">
      <Brand />
      <div className="landing-nav-links">
        <a className="text-link" href="#overview" data-testid="link-landing-overview">Как работает</a>
        <Link className="text-link" href="/sign-in" data-testid="link-sign-in-nav">Войти</Link>
        <Link className="btn btn-primary" href="/sign-up" data-testid="link-sign-up-nav">Создать кабинет <ArrowRight size={15} /></Link>
      </div>
    </nav>
    <section className="hero">
      <div>
        <div className="eyebrow">один взгляд на оба маркетплейса</div>
        <h1>Продажи —<br />без <em>переключений.</em></h1>
        <p className="hero-copy">Сводка объединяет результаты Ozon и Wildberries: выручку, заказы и путь покупателя — в одном спокойном рабочем пространстве.</p>
        <div className="hero-actions">
          <Link className="btn btn-primary" href="/sign-up" data-testid="link-hero-sign-up">Начать работу <ArrowRight size={15} /></Link>
          <Link className="btn btn-outline" href="/sign-in" data-testid="link-hero-sign-in">У меня есть аккаунт</Link>
        </div>
        <p className="hero-footnote">Бесплатное подключение · Ваши ключи остаются защищены</p>
      </div>
      <div className="visual-board" aria-label="Иллюстрация сводки продаж" data-testid="visual-product-preview">
        <div className="visual-top"><span>Пример интерфейса · демонстрация</span><span className="visual-status"><i /> Ozon + WB</span></div>
        <div className="visual-kpis">
          <div className="visual-kpi"><span>Выручка</span><strong>Сводно <small>Ozon + WB</small></strong></div>
          <div className="visual-kpi"><span>Путь до покупки</span><strong>Воронка <small>по этапам</small></strong></div>
        </div>
        <div className="visual-chart">
          <div className="chart-heading"><span>Динамика продаж</span><span>СРАВНЕНИЕ КАНАЛОВ</span></div>
          <div className="mini-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sample} margin={{ top: 12, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#e8e9e1" vertical={false} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#a0aaa3', fontSize: 8 }} />
                <YAxis hide domain={[0, 100]} />
                <Line type="monotone" dataKey="ozon" stroke="#2f726a" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="wb" stroke="#d586b9" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="visual-legend"><span><i className="legend-dot" /> Ozon</span><span><i className="legend-dot pink" /> Wildberries</span></div>
        </div>
        <div className="hero-note"><b>Одна картина</b>Без лишних вкладок и ручного сведения отчетов.</div>
      </div>
    </section>
    <div className="strip"><div className="strip-inner"><strong>Два кабинета. Одна точка опоры.</strong><span>Продажи</span><span>Конверсия</span><span>Синхронизация</span><span>Защищённое подключение</span></div></div>
    <section className="section" id="overview">
      <div className="section-head"><div><div className="eyebrow">меньше рутины — больше ясности</div><h2>Рабочая сводка,<br />а не ещё один отчёт.</h2></div><p className="section-intro">Нужные цифры и состояние подключений собраны в аккуратный обзор — чтобы ежедневная проверка занимала минуты.</p></div>
      <div className="feature-grid">
        <article className="feature-panel dark-panel"><div className="feature-icon"><BarChart3 size={17} /></div><h3>Сравнивайте без таблиц</h3><p>Динамика выручки по двум площадкам, ключевые показатели и выбранный период — в одном графике.</p></article>
        <article className="feature-panel"><div className="feature-icon"><Activity size={17} /></div><h3>Находите шаг, где теряется покупатель</h3><p>Воронки просмотров и заказов помогают заметить узкое место на каждом маркетплейсе.</p></article>
        <article className="feature-panel"><div className="feature-icon"><ShieldCheck size={17} /></div><h3>Ключи — не в браузере</h3><p>Подключение выполняется защищённо. Секретные ключи не сохраняются в локальном хранилище браузера.</p></article>
      </div>
    </section>
    <footer className="landing-footer"><Brand link={false} /><span>Сводка · аналитика продавца</span><Link className="text-link" href="/sign-up" data-testid="link-footer-start">Создать кабинет</Link></footer>
  </main>;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
}
function formatCount(value: number) { return new Intl.NumberFormat('ru-RU').format(value); }
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date).replace('.', '');
}
function syncLabel(value: string | null) {
  if (!value) return 'Синхронизация ещё не выполнялась';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `Обновлено ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed)}`;
}

function Sidebar({ active }: { active: string }) {
  const items = [
    { href: '/dashboard', label: 'Сводка продаж', icon: BarChart3, id: 'dashboard' },
    { href: '/settings', label: 'Подключения', icon: Settings2, id: 'settings' },
  ];
  return <aside className="sidebar">
    <Brand />
    <div className="workspace-label">Рабочее пространство</div>
    {items.map(({ href, label, icon: Icon, id }) => <Link key={id} href={href} className={`nav-item ${active === id ? 'active' : ''}`} data-testid={`nav-${id}`}><Icon /><span>{label}</span></Link>)}
    <div className="sidebar-bottom">продавцам Ozon и WB</div>
  </aside>;
}
function MobileNav({ active }: { active: string }) {
  return <nav className="mobile-nav" aria-label="Основная навигация">
    <Link href="/dashboard" className={`nav-item ${active === 'dashboard' ? 'active' : ''}`} data-testid="mobile-nav-dashboard"><BarChart3 /><span>Сводка</span></Link>
    <Link href="/settings" className={`nav-item ${active === 'settings' ? 'active' : ''}`} data-testid="mobile-nav-settings"><Settings2 /><span>Подключения</span></Link>
  </nav>;
}
function Workspace({ active, children }: { active: string; children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Мой кабинет';
  const initials = name.slice(0, 1).toUpperCase();
  return <div className="workspace">
    <Sidebar active={active} />
    <div className="main-area">
      <header className="topbar">
        <span className="topbar-caption">КАБИНЕТ ПРОДАВЦА <span style={{ color: '#c1c8be' }}> / </span> аналитика</span>
        <div className="topbar-right"><span className="topbar-caption">РАБОЧИЙ ПРОФИЛЬ</span><div className="user-chip"><span className="user-avatar" data-testid="user-avatar">{initials}</span><span data-testid="text-user-name">{name}</span></div><button className="icon-button" aria-label="Выйти из аккаунта" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={15} /></button></div>
      </header>
      {children}
    </div>
    <MobileNav active={active} />
  </div>;
}

function StatCard({ label, value, sub, icon: Icon, change, testId }: { label: string; value: string; sub: string; icon: typeof Activity; change?: number | null; testId: string }) {
  return <div className="panel kpi-card" data-testid={testId}>
    <div className="kpi-label"><span>{label}</span><Icon size={14} /></div>
    <strong className="kpi-value" data-testid={`${testId}-value`}>{value}</strong>
    <div className="kpi-sub">{typeof change === 'number' ? <><span className={change >= 0 ? 'change-positive' : 'change-negative'}>{change >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(change).toLocaleString('ru-RU')}%</span><span>к предыдущему периоду</span></> : sub}</div>
  </div>;
}
function SkeletonDashboard() {
  return <div className="content" aria-label="Загрузка сводки" data-testid="state-dashboard-loading"><div className="loading-skeleton" style={{ width: 240, height: 34, marginBottom: 24 }} /><div className="kpi-grid">{[0,1,2,3].map(i => <div className="panel kpi-card" key={i}><div className="loading-skeleton" style={{ width: '65%', height: 10 }} /><div className="loading-skeleton" style={{ width: '48%', height: 23, marginTop: 18 }} /></div>)}</div><div className="panel" style={{ height: 320 }} /></div>;
}

function DashboardPage() {
  const [period, setPeriod] = useState<'7d'|'30d'|'90d'>('30d');
  const [marketplace, setMarketplace] = useState<'all'|'ozon'|'wildberries'>('all');
  const connectionsQuery = useListMarketplaceConnections();
  const connections = connectionsQuery.data || [];
  const connected = connections.filter(item => item.connected);
  const dashQuery = useGetMarketplaceDashboard({ period, marketplace }, {
    query: { enabled: connected.length > 0, queryKey: getGetMarketplaceDashboardQueryKey({ period, marketplace }) },
  });
  const dashboard = dashQuery.data as MarketplaceDashboard | undefined;
  if (connectionsQuery.isLoading) return <Workspace active="dashboard"><SkeletonDashboard /></Workspace>;
  if (connectionsQuery.isError) return <Workspace active="dashboard"><div className="content"><div className="error-box" data-testid="error-connections-load"><CircleHelp size={17} /><div><b>Не удалось загрузить подключения.</b><p>Попробуйте обновить список.</p><button className="btn btn-outline" onClick={() => connectionsQuery.refetch()} data-testid="button-retry-connections">Повторить</button></div></div></div></Workspace>;
  if (!connected.length) return <Workspace active="dashboard"><div className="content">
    <div className="page-heading"><div><h1>Сводка продаж</h1><p>Общий обзор показателей Ozon и Wildberries</p></div></div>
    <section className="panel empty-state" data-testid="state-no-marketplaces">
      <div className="empty-symbol"><Store size={22} /></div><h2>Сначала подключите магазин</h2>
      <p>Здесь появятся продажи, заказы и воронка конверсии. Подключите Ozon или Wildberries — мы покажем только реальные данные из вашего кабинета.</p>
      <Link className="btn btn-primary" href="/settings" data-testid="link-connect-marketplaces">Подключить маркетплейс <ArrowRight size={15} /></Link>
    </section>
  </div></Workspace>;
  if (dashQuery.isLoading) return <Workspace active="dashboard"><SkeletonDashboard /></Workspace>;
  if (dashQuery.isError || !dashboard) return <Workspace active="dashboard"><div className="content"><div className="page-heading"><div><h1>Сводка продаж</h1><p>Данные временно недоступны</p></div></div><div className="error-box" data-testid="error-dashboard-load"><CircleHelp size={17} /><div><b>Не получилось загрузить аналитику.</b><p>Подключения сохранены. Можно безопасно попробовать ещё раз.</p><button className="btn btn-outline" onClick={() => dashQuery.refetch()} data-testid="button-retry-dashboard">Повторить загрузку</button></div></div></div></Workspace>;
  const series = dashboard.salesSeries.map(item => ({ ...item, shortDate: dateLabel(item.date) }));
  const dataHasSales = dashboard.salesSeries.length > 0;
  const visibleFunnels = dashboard.funnels.filter(f => marketplace === 'all' || f.marketplace === marketplace);
  return <Workspace active="dashboard">
    <main className="content">
      <div className="page-heading">
        <div><h1 data-testid="heading-dashboard">Сводка продаж</h1><p>Все важное о результатах вашего магазина</p></div>
        <div className="heading-actions">
          <select className="select-control" aria-label="Период отчёта" value={period} onChange={e => setPeriod(e.target.value as typeof period)} data-testid="select-period"><option value="7d">Последние 7 дней</option><option value="30d">Последние 30 дней</option><option value="90d">Последние 90 дней</option></select>
          <select className="select-control" aria-label="Маркетплейс" value={marketplace} onChange={e => setMarketplace(e.target.value as typeof marketplace)} data-testid="select-marketplace"><option value="all">Все площадки</option><option value="ozon">Ozon</option><option value="wildberries">Wildberries</option></select>
        </div>
      </div>
      {dashboard.partialErrors.length > 0 && <div className="error-box" style={{ marginBottom: 14 }} data-testid="warning-partial-errors"><CircleHelp size={16} /><div><b>Некоторые данные не удалось получить</b><p>{dashboard.partialErrors.join(' · ')}</p></div></div>}
      <section className="kpi-grid" aria-label="Ключевые показатели">
        <StatCard label="Выручка" value={formatMoney(dashboard.revenue)} sub="За выбранный период" change={dashboard.revenueChangePercent} icon={Wallet} testId="metric-revenue" />
        <StatCard label="Заказы" value={formatCount(dashboard.orders)} sub="Оплаченные и ожидающие" icon={ShoppingBag} testId="metric-orders" />
        <StatCard label="Продано единиц" value={formatCount(dashboard.units)} sub="Количество товаров" icon={Layers3} testId="metric-units" />
        <StatCard label="Средний чек" value={formatMoney(dashboard.averageOrderValue)} sub="Средняя сумма заказа" icon={TrendingUp} testId="metric-average-check" />
      </section>
      <section className="panel chart-panel">
        <div className="panel-header"><div><h2>Динамика выручки</h2><p>Рубли · ежедневно за выбранный период</p></div><div className="chart-legend"><span><i /> Ozon</span><span><i className="pink" /> Wildberries</span></div></div>
        {dataHasSales ? <div className="sales-chart" data-testid="chart-sales">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#ecece5" vertical={false} />
              <XAxis dataKey="shortDate" axisLine={false} tickLine={false} tick={{ fill: '#96a19a', fontSize: 10 }} minTickGap={28} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#96a19a', fontSize: 10 }} tickFormatter={v => `${(Number(v)/1000).toLocaleString('ru-RU')} тыс.`} width={56} />
              <Tooltip formatter={(value: number, name: string) => [formatMoney(value), name === 'ozonRevenue' ? 'Ozon' : name === 'wildberriesRevenue' ? 'Wildberries' : 'Всего']} labelStyle={{ color: '#52635e', fontSize: 11 }} contentStyle={{ border: '1px solid #e1e3da', borderRadius: 9, background: '#fffefa', fontSize: 11 }} />
              {(marketplace === 'all' || marketplace === 'ozon') && <Line type="monotone" dataKey="ozonRevenue" name="ozonRevenue" stroke="#2f726a" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} />}
              {(marketplace === 'all' || marketplace === 'wildberries') && <Line type="monotone" dataKey="wildberriesRevenue" name="wildberriesRevenue" stroke="#d586b9" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} />}
            </LineChart>
          </ResponsiveContainer>
        </div> : <div className="empty-chart" data-testid="state-no-sales-series"><div><Activity size={20} /><p>За выбранный период нет данных для графика.</p></div></div>}
      </section>
      <div className="lower-grid">
        <section className="panel funnel-panel">
          <div className="panel-header"><div><h2>Воронка продаж</h2><p>От просмотра карточки до покупки</p></div></div>
          {visibleFunnels.length ? visibleFunnels.map((funnel, index) => {
            const label = funnel.marketplace === 'ozon' ? 'Ozon' : 'Wildberries';
            return <div className="funnel" key={funnel.marketplace} data-testid={`funnel-${funnel.marketplace}`}>
              <div className="funnel-title"><i className={`market-dot ${funnel.marketplace === 'wildberries' ? 'wb' : ''}`} />{label}</div>
              <div className="funnel-stages">
                <div className="funnel-stage" data-testid={`funnel-views-${index}`}><span>Просмотры</span><strong>{formatCount(funnel.views)}</strong></div>
                <div className="funnel-stage" data-testid={`funnel-carts-${index}`}><span>В корзину</span><strong>{formatCount(funnel.cartAdds)}</strong></div>
                <div className="funnel-stage" data-testid={`funnel-orders-${index}`}><span>Заказы</span><strong>{formatCount(funnel.orders)}</strong></div>
                {funnel.marketplace === 'wildberries' && <div className="funnel-stage" data-testid={`funnel-purchases-${index}`}><span>Выкупы</span><strong>{formatCount(funnel.purchases)}</strong></div>}
              </div>
              <div className="funnel-rate"><span>Просмотр → корзина <b>{funnel.viewToCartPercent.toLocaleString('ru-RU')}%</b></span><span>Корзина → заказ <b>{funnel.cartToOrderPercent.toLocaleString('ru-RU')}%</b></span>{funnel.marketplace === 'wildberries' && <span>Выкуп <b>{funnel.orderToPurchasePercent.toLocaleString('ru-RU')}%</b></span>}</div>
            </div>;
          }) : <div className="empty-chart" data-testid="state-no-funnels"><div><ShoppingCart size={20} /><p>Для выбранной площадки воронка пока не доступна.</p></div></div>}
        </section>
        <section className="panel connections-overview">
          <div className="panel-header"><div><h2>Подключения</h2><p>Состояние синхронизации магазинов</p></div><Link className="text-link" href="/settings" data-testid="link-manage-connections">Настроить <ArrowRight size={13} /></Link></div>
          {connections.map(item => <ConnectionRow key={item.marketplace} connection={item} />)}
        </section>
      </div>
    </main>
  </Workspace>;
}

function ConnectionRow({ connection }: { connection: MarketplaceConnection }) {
  const isOzon = connection.marketplace === 'ozon';
  const label = isOzon ? 'Ozon' : 'Wildberries';
  return <div className="connection-line" data-testid={`connection-row-${connection.marketplace}`}>
    <div className="connection-main"><span className={`market-badge ${isOzon ? '' : 'wb'}`}>{isOzon ? 'OZ' : 'WB'}</span><div><div className="connection-name">{connection.storeName || label}</div><div className="connection-detail" data-testid={`connection-sync-${connection.marketplace}`}>{connection.statusMessage || syncLabel(connection.lastSyncAt)}</div></div></div>
    <span className={`status-pill ${connection.connected ? 'connected' : connection.statusMessage ? 'issue' : ''}`} data-testid={`connection-status-${connection.marketplace}`}>{connection.connected ? 'Подключён' : 'Не подключён'}</span>
  </div>;
}

function MarketplaceCard({ marketplace, connection }: { marketplace: 'ozon'|'wildberries'; connection?: MarketplaceConnection }) {
  const [clientId, setClientId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [notice, setNotice] = useState('');
  const queryClient = useQueryClient();
  const ozonConnect = useConnectOzon();
  const wbConnect = useConnectWildberries();
  const disconnect = useDisconnectMarketplace();
  const isOzon = marketplace === 'ozon';
  const label = isOzon ? 'Ozon' : 'Wildberries';
  const isPending = isOzon ? ozonConnect.isPending : wbConnect.isPending;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    const options = {
      onSuccess: async () => {
        setApiKey('');
        setClientId('');
        setNotice('Подключение проверено и сохранено.');
        await queryClient.invalidateQueries({ queryKey: getListMarketplaceConnectionsQueryKey() });
        await queryClient.invalidateQueries({ queryKey: getGetMarketplaceDashboardQueryKey() });
      },
      onError: () => setNotice('Не удалось проверить ключи. Проверьте данные и попробуйте ещё раз.'),
    };
    if (isOzon) ozonConnect.mutate({ data: { clientId, apiKey } }, options);
    else wbConnect.mutate({ data: { apiKey } }, options);
  };
  const disconnectStore = () => {
    if (!window.confirm(`Отключить ${label}? Аналитика этой площадки перестанет обновляться.`)) return;
    setNotice('');
    disconnect.mutate({ marketplace }, {
      onSuccess: async () => {
        setNotice('Магазин отключён.');
        await queryClient.invalidateQueries({ queryKey: getListMarketplaceConnectionsQueryKey() });
        await queryClient.invalidateQueries({ queryKey: getGetMarketplaceDashboardQueryKey() });
      },
      onError: () => setNotice('Не удалось отключить магазин. Попробуйте ещё раз.'),
    });
  };
  const mutationError = (isOzon ? ozonConnect.error : wbConnect.error) || disconnect.error;
  const connected = Boolean(connection?.connected);
  return <section className="panel settings-card" data-testid={`settings-card-${marketplace}`}>
    <div className="settings-card-header"><div className="settings-market"><span className={`market-badge ${isOzon ? '' : 'wb'}`}>{isOzon ? 'OZ' : 'WB'}</span><div><h2>{label}</h2><p>{connected ? connection?.storeName || 'Магазин подключён' : 'API-подключение'}</p></div></div><span className={`status-pill ${connected ? 'connected' : connection?.statusMessage ? 'issue' : ''}`} data-testid={`settings-status-${marketplace}`}>{connected ? 'Подключён' : 'Не подключён'}</span></div>
    {connected ? <div className="form-stack">
      <div className="connection-detail" data-testid={`settings-sync-${marketplace}`}>{connection?.statusMessage || syncLabel(connection?.lastSyncAt || null)}</div>
      <div className="settings-actions"><button className="btn btn-danger" disabled={disconnect.isPending} onClick={disconnectStore} data-testid={`button-disconnect-${marketplace}`}>{disconnect.isPending ? 'Отключаем…' : 'Отключить магазин'}</button><button className="btn btn-outline" onClick={() => { setNotice(''); setApiKey(''); setClientId(''); setVisible(true); }} data-testid={`button-reconnect-${marketplace}`}>Сменить ключи</button></div>
      {(notice || mutationError) && <p className={mutationError ? 'form-error' : 'form-success'} data-testid={`status-feedback-${marketplace}`}>{notice || 'Операция не выполнена. Повторите попытку.'}</p>}
      {notice === '' && <button className="text-link" onClick={() => setVisible(v => !v)} data-testid={`button-toggle-credentials-${marketplace}`}>{visible ? 'Скрыть форму обновления ключей' : 'Обновить ключи'}</button>}
      {visible && <CredentialForm isOzon={isOzon} clientId={clientId} apiKey={apiKey} setClientId={setClientId} setApiKey={setApiKey} submit={submit} isPending={isPending} />}
    </div> : <CredentialForm isOzon={isOzon} clientId={clientId} apiKey={apiKey} setClientId={setClientId} setApiKey={setApiKey} submit={submit} isPending={isPending} feedback={notice} error={Boolean(mutationError)} />}
  </section>;
}

function CredentialForm({ isOzon, clientId, apiKey, setClientId, setApiKey, submit, isPending, feedback, error }: {
  isOzon: boolean; clientId: string; apiKey: string; setClientId: (v: string) => void; setApiKey: (v: string) => void;
  submit: (event: React.FormEvent<HTMLFormElement>) => void; isPending: boolean; feedback?: string; error?: boolean;
}) {
  const label = isOzon ? 'ozon' : 'wildberries';
  return <form className="form-stack" onSubmit={submit} data-testid={`form-connect-${label}`}>
    {isOzon && <label className="field-label">Client ID<input className="text-input" type="text" required autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Введите Client ID" data-testid="input-ozon-client-id" /></label>}
    <label className="field-label">API-ключ<input className="text-input" type="password" required autoComplete="new-password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Вставьте API-ключ" data-testid={`input-${label}-api-key`} /></label>
    <div className="form-hint"><LockKeyhole size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Ключи используются для проверки подключения и не сохраняются в браузере.</div>
    <div className="settings-actions"><button className="btn btn-primary" type="submit" disabled={isPending || !apiKey || (isOzon && !clientId)} data-testid={`button-connect-${label}`}>{isPending ? 'Проверяем…' : connectedLabel(isOzon)}</button>{isPending && <RefreshCw size={14} className="spin-icon" />}</div>
    {feedback && <p className={error ? 'form-error' : 'form-success'} data-testid={`status-feedback-${label}`}>{feedback}</p>}
  </form>;
}
function connectedLabel(isOzon: boolean) { return isOzon ? 'Подключить Ozon' : 'Подключить Wildberries'; }

function SettingsPage() {
  const connectionsQuery = useListMarketplaceConnections();
  const connections = connectionsQuery.data || [];
  const ozon = connections.find(item => item.marketplace === 'ozon');
  const wb = connections.find(item => item.marketplace === 'wildberries');
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress || 'Адрес не указан';
  const name = user?.fullName || email;
  if (connectionsQuery.isLoading) return <Workspace active="settings"><div className="content" data-testid="state-settings-loading"><div className="loading-skeleton" style={{ width: 250, height: 30, marginBottom: 22 }} /><div className="settings-grid"><div className="panel loading-skeleton" style={{ height: 340 }} /><div className="panel loading-skeleton" style={{ height: 340 }} /></div></div></Workspace>;
  return <Workspace active="settings"><main className="content">
    <div className="page-heading"><div><h1 data-testid="heading-settings">Настройки</h1><p>Профиль и безопасное подключение магазинов</p></div></div>
    {connectionsQuery.isError && <div className="error-box" style={{ marginBottom: 14 }} data-testid="error-settings-connections"><CircleHelp size={16} /><div><b>Статус подключений недоступен.</b><p>Формы подключения работают, но список можно обновить.</p><button className="btn btn-outline" onClick={() => connectionsQuery.refetch()} data-testid="button-retry-settings">Обновить статус</button></div></div>}
    <div className="settings-grid">
      <MarketplaceCard marketplace="ozon" connection={ozon} />
      <MarketplaceCard marketplace="wildberries" connection={wb} />
    </div>
    <section className="panel profile-panel">
      <div className="panel-header"><div><h2>Профиль</h2><p>Ваш аккаунт кабинета</p></div></div>
      <div className="profile-row"><span className="profile-big" data-testid="settings-user-avatar">{name.slice(0,1).toUpperCase()}</span><div><strong data-testid="settings-user-name">{name}</strong><span data-testid="settings-user-email">{email}</span></div></div>
      <div className="security-note"><strong><ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />Защита данных</strong><br />Секретные API-ключи передаются для проверки на сервер и не сохраняются в localStorage или другом хранилище браузера. Используйте ключи с минимально необходимыми правами.</div>
    </section>
  </main></Workspace>;
}

function HomeRoute() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><Landing /></Show></>;
}
function ProtectedDashboard() {
  return <><Show when="signed-in"><DashboardPage /></Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}
function ProtectedSettings() {
  return <><Show when="signed-in"><SettingsPage /></Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}
function SignInPage() {
  return <div className="auth-shell"><section className="auth-story"><Brand /><div className="eyebrow" style={{ marginTop: 44 }}>всё начинается с ясной картины</div><h1>Ваши продажи<br />в одном месте.</h1><p>Войдите в кабинет, чтобы увидеть показатели магазинов Ozon и Wildberries.</p></section><div className="auth-form-wrap"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}/dashboard`} /></div></div>;
}
function SignUpPage() {
  return <div className="auth-shell"><section className="auth-story"><Brand /><div className="eyebrow" style={{ marginTop: 44 }}>кабинет продавца</div><h1>Соберите<br />продажи вместе.</h1><p>Создайте аккаунт и подключите площадки — ваша сводка начнёт складываться из реальных данных.</p></section><div className="auth-form-wrap"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/dashboard`} /></div></div>;
}
function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      ...ruRU,
      signIn: {
        ...(ruRU.signIn ?? {}),
        start: {
          ...(ruRU.signIn?.start ?? {}),
          title: 'С возвращением',
          subtitle: 'Войдите в кабинет продавца',
        },
      },
      signUp: {
        ...(ruRU.signUp ?? {}),
        start: {
          ...(ruRU.signUp?.start ?? {}),
          title: 'Создайте кабинет',
          subtitle: 'Собирайте аналитику Ozon и Wildberries в одном месте',
        },
      },
    }}
    routerPush={to => setLocation(stripBase(to))}
    routerReplace={to => setLocation(stripBase(to), { replace: true })}
  >
    <RoutedErrorBoundary><Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard" component={ProtectedDashboard} />
      <Route path="/settings" component={ProtectedSettings} />
      <Route component={NotFound} />
    </Switch></RoutedErrorBoundary>
  </ClerkProvider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
