import { useMemo } from 'react';
import { Link, useRoute } from 'wouter';
import { RefreshCw, ArrowUpRight, MapPin } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  PLATFORMS,
  PRODUCTS,
  GEOGRAPHY,
  daysFor,
  periodKpis,
  revenueSeries,
  funnelStages,
  funnelSeries,
  logDomain,
  logTicks,
} from '@/data/mock';
import type { PlatformId } from '@/data/mock';
import { formatMoney, formatNumber } from '@/lib/format';
import { PlatformChip, Delta, EmptyState } from '@/components/ui-bits';

const PERIODS = [
  { key: 'week', label: 'Неделя', days: 7 },
  { key: 'month', label: 'Месяц', days: 30 },
  { key: 'quarter', label: 'Квартал', days: 90 },
] as const;

const shortMoney = (v: number): string => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

export default function MarketplaceDetailPage() {
  const [match, params] = useRoute('/marketplace/:id');
  const id = match ? (params?.id ?? '') : '';
  const platform = PLATFORMS.find((p) => p.id === id);

  if (!platform) {
    return (
      <EmptyState
        icon={<MapPin size={22} />}
        title="Площадка не найдена"
        text="Возможно, она ещё не подключена."
        action={<Link href="/settings" className="btn btn-primary">Перейти в настройки</Link>}
      />
    );
  }

  const pid = platform.id as PlatformId;
  return <PlatformView pid={pid} />;
}

function PlatformView({ pid }: { pid: PlatformId }) {
  const platform = PLATFORMS.find((p) => p.id === pid)!;
  const daysData = useMemo(() => daysFor(pid), [pid]);
  const kpis = useMemo(() => periodKpis([pid], 30), [pid]);
  const series = useMemo(() => revenueSeries([pid], 30), [pid]);
  const stages = useMemo(() => funnelStages([pid], 30, 'units'), [pid]);
  const funnelData = useMemo(() => funnelSeries([pid], 30, 'units', 'day'), [pid]);
  const funnelYDomain = useMemo(
    () => logDomain(funnelData.flatMap((p) => [p.visits, p.cart, p.ordered, p.bought])),
    [funnelData],
  );
  const funnelYTicks = useMemo(() => logTicks(funnelYDomain), [funnelYDomain]);
  const products = useMemo(() => PRODUCTS.filter((p) => p.platform === pid).sort((a, b) => b.revenue - a.revenue), [pid]);

  const buyoutRate = useMemo(() => {
    const days = daysData.slice(-30);
    const ordered = days.reduce((a, d) => a + d.units, 0);
    const bought = days.reduce((a, d) => a + d.bought, 0);
    return ordered > 0 ? (bought / ordered) * 100 : 0;
  }, [daysData]);

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <PlatformChip id={pid} size={42} />
          <div>
            <h1>{platform.name}</h1>
            <div className="subtitle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-green">Активен</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <RefreshCw size={12} />
                Синхронизация: 2 мин назад
              </span>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <Link href="/funnel" className="btn btn-outline">Воронка продаж</Link>
          <Link href="/settings" className="btn btn-outline">Настройки API</Link>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Выручка за месяц</div>
            <div className="kpi-value">{formatMoney(kpis.revenue.value)}</div>
            <Delta value={kpis.revenue.change} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Заказы</div>
            <div className="kpi-value">{formatNumber(kpis.orders.value)}</div>
            <Delta value={kpis.orders.change} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Средний чек</div>
            <div className="kpi-value">{formatMoney(kpis.avgCheck.value)}</div>
            <Delta value={kpis.avgCheck.change} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Процент выкупа</div>
            <div className="kpi-value">{buyoutRate.toFixed(1).replace('.', ',')}%</div>
            <div className="kpi-delta" style={{ marginTop: 6 }}>фактические продажи: {formatMoney(kpis.boughtRevenue.value)}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">Заказано товаров</h2>
            <div className="card-sub">В рублях за 30 дней</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-detail-${pid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={platform.color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={platform.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 6" stroke="#edf0f3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tickFormatter={shortMoney} tickLine={false} axisLine={false} width={44} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} />
            <Area type="monotone" dataKey={pid} name={platform.name} stroke={platform.color} strokeWidth={2.2} fill={`url(#grad-detail-${pid})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">Воронка продаж</h2>
            <div className="card-sub">За 30 дней, штуки, лог. шкала</div>
          </div>
          <Link href="/funnel" className="link">Подробнее →</Link>
        </div>
        <div className="funnel-layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stages.map((s) => (
              <div className="funnel-stage active" key={s.key}>
                <div className="stage-name">
                  <span className="stage-check" style={{ background: s.color }} />
                  {s.name}
                </div>
                <div className="stage-value">
                  {formatNumber(s.value)}
                  <Delta value={s.change} />
                </div>
                {s.note ? <div className="stage-note">{s.note}</div> : null}
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={330}>
            <LineChart data={funnelData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#eef1f4" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={26} />
              <YAxis
                scale="log"
                domain={funnelYDomain}
                allowDataOverflow
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v: number) => formatNumber(v)}
                ticks={funnelYTicks}
              />
              <Tooltip formatter={(v) => formatNumber(Number(v))} />
              <Line type="monotone" dataKey="visits" name="Перешли в карточку" stroke="#e6448c" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="cart" name="Добавили в корзину" stroke="#7c3aed" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="ordered" name="Заказали" stroke="#14b8a6" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="bought" name="Выкупили" stroke="#3b82f6" strokeWidth={2.2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2-even">
        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Топ товаров</h2>
              <div className="card-sub">По выручке за месяц</div>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Заказы</th>
                  <th>Выручка</th>
                  <th>Остаток</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="num">{formatNumber(p.orders)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{formatMoney(p.revenue)}</td>
                    <td className="num">{p.stock} шт</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">География заказов</h2>
              <div className="card-sub">Доля региона в заказах</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {GEOGRAPHY[pid].map((g) => (
              <div key={g.region}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  <span>{g.region}</span>
                  <span className="num" style={{ color: 'var(--muted)' }}>{g.share.toFixed(1).replace('.', ',')}%</span>
                </div>
                <div className="progress">
                  <div style={{ width: `${g.share * 3}%`, background: platform.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

