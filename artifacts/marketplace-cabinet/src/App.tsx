import { useEffect, useState } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { BarChart3, Filter, LayoutGrid, Menu, Settings, Store, Wallet, Package, UsersRound, ListTodo } from 'lucide-react';
import { Logo } from '@/components/Logo';
import DashboardPage from '@/pages/Dashboard';
import MarketplacesPage from '@/pages/Marketplaces';
import MarketplaceDetailPage from '@/pages/MarketplaceDetail';
import FunnelPage from '@/pages/Funnel';
import AnalyticsPage from '@/pages/Analytics';
import FinancePage from '@/pages/Finance';
import ProductsPage from '@/pages/Products';
import SettingsPage from '@/pages/Settings';
import NotFoundPage from '@/pages/NotFound';
import TeamPage from '@/pages/Team';
import TasksPage from '@/pages/Tasks';
import { getWorkspace, switchCompany } from '@/lib/workspace-api';
import { getMarketplaceStores } from '@/lib/marketplace-api';
import type { Workspace } from '@/lib/workspace-api';
import { ErrorBoundary } from '@/components/error-boundary';
import './index.css';

const NAV = [
  { href: '/', label: 'Дашборд', icon: LayoutGrid, match: (p: string) => p === '/' },
  { href: '/marketplaces', label: 'Маркетплейсы', icon: Store, match: (p: string) => p.startsWith('/marketplace') },
  { href: '/funnel', label: 'Воронка продаж', icon: Filter, match: (p: string) => p === '/funnel' },
  { href: '/analytics', label: 'Аналитика', icon: BarChart3, match: (p: string) => p === '/analytics' },
  { href: '/finance', label: 'Финансы', icon: Wallet, match: (p: string) => p === '/finance' },
  { href: '/products', label: 'Товары', icon: Package, match: (p: string) => p === '/products' || p === '/cogs' },
  { href: '/settings', label: 'Подключения API', icon: Settings, match: (p: string) => p === '/settings' },
  { href: '/team', label: 'Компания и команда', icon: UsersRound, match: (p: string) => p === '/team' },
  { href: '/tasks', label: 'Задачи', icon: ListTodo, match: (p: string) => p === '/tasks' },
];

function Workspace({ children, userEmail, onLogout }: { children: React.ReactNode; userEmail: string; onLogout: () => void }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [stores, setStores] = useState<Array<{ id: number; marketplace: string; storeName: string }>>([]);
  const [activeStoreId, setActiveStoreId] = useState(() => localStorage.getItem('navigator-active-store-id') ?? '');
  useEffect(() => {
    void getWorkspace().then(setWorkspace).catch(() => undefined);
    void getMarketplaceStores().then((result) => {
      setStores(result.stores);
      const selected = localStorage.getItem('navigator-active-store-id') ?? '';
      if (selected && !result.stores.some((store) => String(store.id) === selected)) {
        localStorage.removeItem('navigator-active-store-id'); setActiveStoreId('');
      }
    }).catch(() => undefined);
  }, []);
  async function changeCompany(companyId: string) {
    try { await switchCompany(companyId); window.location.reload(); } catch { window.alert('Не удалось переключить компанию. Обновите страницу и попробуйте снова.'); }
  }
  const currentMember = workspace?.members.find((member) => member.userId === workspace.currentUserId);
  useEffect(() => {
    const refreshStores = () => {
      void getMarketplaceStores().then(result => {
        setStores(result.stores);
        const selected = localStorage.getItem('navigator-active-store-id');
        if (selected && !result.stores.some(store => String(store.id) === selected)) {
          localStorage.removeItem('navigator-active-store-id'); setActiveStoreId('');
        }
      }).catch(() => undefined);
    };
    window.addEventListener('marketplace-stores-updated', refreshStores);
    return () => window.removeEventListener('marketplace-stores-updated', refreshStores);
  }, []);
  const elevated = workspace?.role === 'owner' || workspace?.role === 'admin';
  const visibleNav = NAV.filter((item) => item.href === '/team' || !workspace || elevated || currentMember?.sections.includes(
    item.href === '/' ? 'dashboard' : item.href === '/marketplaces' ? 'marketplaces' : item.href.slice(1),
  ));
  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand"><Logo size={36} /><div><div className="brand-name">Навигатор продаж</div><div className="brand-sub">Единый кабинет продавца</div></div></div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visibleNav.map((item) => { const Icon = item.icon; return <a key={item.href} href={item.href} className={`nav-item${item.match(location) ? ' active' : ''}`} onClick={() => setOpen(false)}><Icon size={17} />{item.label}</a>; })}
        </nav>
        <div className="sidebar-footer">© 2026 Навигатор продаж</div>
      </aside>
      <main className="main">
        <div className="app-topbar">
          <button className="mobile-menu-btn" aria-label="Меню" onClick={() => setOpen((v) => !v)}><Menu size={18} /></button>
          <div className="account-bar">{workspace && workspace.companies.length > 1 && <select aria-label="Активная компания" value={workspace.activeCompanyId} onChange={(event) => void changeCompany(event.target.value)}>{workspace.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>}{stores.length > 0 && <select aria-label="Фильтр по магазину" value={activeStoreId} onChange={(event) => { const id = event.target.value; if (id) localStorage.setItem('navigator-active-store-id', id); else localStorage.removeItem('navigator-active-store-id'); setActiveStoreId(id); window.location.reload(); }}><option value="">Все магазины</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.storeName} · {store.marketplace === 'ozon' ? 'Ozon' : 'Wildberries'}</option>)}</select>}<span title={userEmail}>{userEmail}</span><button className="btn" onClick={onLogout}>Выйти</button></div>
        </div>
        {children}
      </main>
    </div>
  );
}

export default function App({ userEmail, onLogout }: { userEmail: string; onLogout: () => void }) {
  return <ErrorBoundary><Workspace userEmail={userEmail} onLogout={onLogout}><Switch>
    <Route path="/" component={DashboardPage} />
    <Route path="/marketplaces" component={MarketplacesPage} />
    <Route path="/marketplace/:id" component={MarketplaceDetailPage} />
    <Route path="/funnel" component={FunnelPage} />
    <Route path="/analytics" component={AnalyticsPage} />
    <Route path="/finance" component={FinancePage} />
    <Route path="/products" component={ProductsPage} />
    <Route path="/cogs" component={ProductsPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route path="/team" component={TeamPage} />
    <Route path="/tasks" component={TasksPage} />
    <Route path="/invitations/accept" component={TeamPage} />
    <Route component={NotFoundPage} />
  </Switch></Workspace></ErrorBoundary>;
}
