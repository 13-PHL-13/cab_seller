import { Link } from 'wouter';
import { ArrowUpRight, Plug, RefreshCw } from 'lucide-react';
import { PLATFORMS, periodKpis, type PlatformId } from '@/data/mock';
import { formatMoney, formatNumber, timeAgo } from '@/lib/format';
import { loadSettings } from '@/data/settings';
import { PlatformChip, Delta } from '@/components/ui-bits';

const PERIOD_DAYS = 30;

/** Страница «Маркетплейсы» — обзор всех интегрированных площадок. */
export default function MarketplacesPage() {
  const settings = loadSettings();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Маркетплейсы</h1>
          <div className="subtitle">Интегрированные торговые площадки и их показатели за месяц</div>
        </div>
        <div className="header-actions">
          <Link href="/settings" className="btn btn-outline">
            <Plug size={15} />
            Подключить площадку
          </Link>
        </div>
      </div>

      <div className="grid-2-even">
        {PLATFORMS.map((p) => {
          const k = periodKpis([p.id as PlatformId], PERIOD_DAYS);
          const conn = settings.connections[p.id];
          const connected = conn?.connected ?? false;
          return (
            <div className="card mp-card" key={p.id}>
              <div className="mp-head">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <PlatformChip id={p.id} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
                    <span className={`badge ${connected ? 'badge-green' : 'badge-gray'}`} style={{ marginTop: 3 }}>
                      {connected ? 'Активен' : 'Не подключён'}
                    </span>
                  </div>
                </div>
                {connected ? (
                  <span className="badge badge-blue" style={{ gap: 6 }}>
                    <RefreshCw size={11} />
                    {conn.syncedAt ? `Синхр. ${timeAgo(Math.floor((Date.now() - conn.syncedAt) / 1000))}` : 'Синхронизация…'}
                  </span>
                ) : null}
              </div>
              <div className="mp-stats">
                <div className="mp-stat">
                  <div className="l">Выручка</div>
                  <div className="v">{formatMoney(k.revenue.value)}</div>
                  <Delta value={k.revenue.change} />
                </div>
                <div className="mp-stat">
                  <div className="l">Заказы</div>
                  <div className="v">{formatNumber(k.orders.value)}</div>
                  <Delta value={k.orders.change} />
                </div>
                <div className="mp-stat">
                  <div className="l">Факт. продажи</div>
                  <div className="v">{formatMoney(k.boughtRevenue.value)}</div>
                  <Delta value={k.boughtRevenue.change} />
                </div>
              </div>
              {connected ? (
                <Link href={`/marketplace/${p.id}`} className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                  Открыть площадку
                  <ArrowUpRight size={15} />
                </Link>
              ) : (
                <Link href="/settings" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>
                  Подключить по API
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
