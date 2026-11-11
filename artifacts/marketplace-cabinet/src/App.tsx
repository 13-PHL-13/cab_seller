import { useState } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { BarChart3, Filter, LayoutGrid, Menu, Settings, Store, Wallet } from 'lucide-react';
import { Logo } from '@/components/Logo';
import DashboardPage from '@/pages/Dashboard';
import MarketplacesPage from '@/pages/Marketplaces';
import MarketplaceDetailPage from '@/pages/MarketplaceDetail';
import FunnelPage from '@/pages/Funnel';
import AnalyticsPage from '@/pages/Analytics';
import FinancePage from '@/pages/Finance';
import SettingsPage from '@/pages/Settings';
import NotFoundPage from '@/pages/NotFound';
import { ErrorBoundary } from '@/components/error-boundary';
import './index.css';

const NAV = [
  { href: '/', label: 'Дашборд', icon: LayoutGrid, match: (p: string) => p === '/' },
  { href: '/marketplaces', label: 'Маркетплейсы', icon: Store, match: (p: string) => p.startsWith('/marketplace') },
  { href: '/funnel', label: 'Воронка продаж', icon: Filter, match: (p: string) => p === '/funnel' },
  { href: '/analytics', label: 'Аналитика', icon: BarChart3, match: (p: string) => p === '/analytics' },
  { href: '/finance', label: 'Финансы', icon: Wallet, match: (p: string) => p === '/finance' },
  { href: '/settings', label: 'Настройки', icon: Settings, match: (p: string) => p === '/settings' },
];

function Workspace({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <Logo size={36} />
          <div>
            <div className="brand-name">Навигатор продаж</div>
            <div className="brand-sub">Единый кабинет продавца</div>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`nav-item${item.match(location) ? ' active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <Icon size={17} />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-footer">© 2026 Навигатор продаж</div>
      </aside>

      <main className="main">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button className="mobile-menu-btn" aria-label="Меню" onClick={() => setOpen((v) => !v)}>
            <Menu size={18} />
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Workspace>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/marketplaces" component={MarketplacesPage} />
          <Route path="/marketplace/:id" component={MarketplaceDetailPage} />
          <Route path="/funnel" component={FunnelPage} />
          <Route path="/analytics" component={AnalyticsPage} />
          <Route path="/finance" component={FinancePage} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFoundPage} />
        </Switch>
      </Workspace>
    </ErrorBoundary>
  );
}
