import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Check, DollarSign, Eye, Package, ShoppingCart, ArrowUpRight } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PLATFORMS, periodKpis, revenueSeries, weekdayOrders, RECENT_ORDERS, funnelStages, funnelSeries, funnelStagesByPlatform, logDomain, logTicks } from '@/data/mock';
import type { PlatformId } from '@/data/mock';
import { formatMoney, formatNumber, formatDate } from '@/lib/format';
import { PlatformChip, Delta, MiniDelta, STATUS_BADGE } from '@/components/ui-bits';
import { FunnelTooltip } from '@/components/FunnelTooltip';

const PERIODS = [
  { key: 'week', label: 'Неделя', days: 7 },
  { key: 'month', label: 'Месяц', days: 30 },
  { key: 'quarter', label: 'Квартал', days: 90 },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

const shortMoney = (v: number): string => {
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
};

export default function DashboardPage() {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const days = PERIODS.find((p) => p.key === period)!.days;

  const kpis = useMemo(() => periodKpis(['ozon', 'wb'], days), [days]);
  const series = useMemo(() => revenueSeries(['ozon', 'wb'], days), [days]);
  const week = useMemo(() => weekdayOrders(['ozon', 'wb']), []);
  const funnel = useMemo(() => funnelStages(['ozon', 'wb'], days, 'units'), [days]);
  const funnelData = useMemo(() => funnelSeries(['ozon', 'wb'], days, 'units', 'day'), [days]);
  const funnelYDomain = useMemo(
    () => logDomain(funnelData.flatMap((p) => [p.visits, p.cart, p.ordered, p.bought])),
    [funnelData],
  );
  const funnelYTicks = useMemo(() => logTicks(funnelYDomain), [funnelYDomain]);
  const funnelSplit = useMemo(() => funnelStagesByPlatform(['ozon', 'wb'], days, 'units'), [days]);

  const kpiCards = [
    { label: 'Общая выручка', value: formatMoney(kpis.revenue.value), change: kpis.revenue.change, icon: <DollarSign size={17} />, bg: '#e3f2ec', color: '#0e7a62' },
    { label: 'Заказы', value: formatNumber(kpis.orders.value), change: kpis.orders.change, icon: <ShoppingCart size={17} />, bg: '#e3edff', color: '#1d4ed8' },
    { label: 'Просмотры', value: formatNumber(kpis.views.value), change: kpis.views.change, icon: <Eye size={17} />, bg: '#f3e8ff', color: '#7e22ce' },
    { label: 'Средний чек', value: formatMoney(kpis.avgCheck.value), change: kpis.avgCheck.change, icon: <Package size={17} />, bg: '#fef3e2', color: '#b45309' },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Дашборд</h1>
          <div className="subtitle">Обзор продаж по всем площадкам</div>
        </div>
        <div className="header-actions">
          <div className="segmented">
            {PERIODS.map((p) => (
              <button key={p.key} className={period === p.key ? 'active' : ''} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        {kpiCards.map((k) => (
          <div className="kpi-card" key={k.label}>
            <div>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
              <Delta value={k.change} />
            </div>
            <div className="kpi-icon" style={{ background: k.bg, color: k.color }}>{k.icon}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Динамика продаж</h2>
              <div className="card-sub">Выручка по площадкам, ₽</div>
            </div>
            <div className="chart-legend">
              {PLATFORMS.map((p) => (
                <span className="item" key={p.id}>
                  <span className="dot" style={{ background: p.color }} />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {PLATFORMS.map((p) => (
                  <linearGradient key={p.id} id={`grad-${p.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="4 6" stroke="#edf0f3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
              <YAxis tickFormatter={shortMoney} tickLine={false} axisLine={false} width={44} />
              <Tooltip formatter={(v) => formatMoney(Number(v))} />
              {PLATFORMS.map((p) => (
                <Area
                  key={p.id}
                  type="monotone"
                  dataKey={p.id}
                  name={p.name}
                  stroke={p.color}
                  strokeWidth={2.2}
                  fill={`url(#grad-${p.id})`}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Заказы за неделю</h2>
              <div className="card-sub">Заказы и возвраты</div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={week} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="4 6" stroke="#edf0f3" vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <Tooltip />
              <Bar dataKey="orders" name="Заказы" fill="#2f7df6" radius={[6, 6, 0, 0]} maxBarSize={26} />
              <Bar dataKey="returns" name="Возвраты" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">Воронка продаж</h2>
            <div className="card-sub">
              Переходы в карточку и добавление в корзину по всем площадкам (Ozon + Wildberries), штуки, лог. шкала
            </div>
          </div>
          <Link href="/funnel" className="link">Подробнее →</Link>
        </div>
        <div className="funnel-layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {funnel.map((s, idx) => (
              <div className="funnel-stage active" key={s.key}>
                <div className="stage-name">
                  <span className="stage-check" style={{ background: s.color }}>
                    <Check size={12} />
                  </span>
                  {s.name}
                </div>
                <div className="stage-value">
                  {formatNumber(s.value)}
                  <MiniDelta value={s.change} />
                </div>
                {s.note ? <div className="stage-note">{s.note}</div> : null}
                <div className="stage-split">
                  {(['ozon', 'wb'] as PlatformId[]).map((pid) => (
                    <span key={pid}>
                      <span className="tt-dot" style={{ background: PLATFORMS.find((p) => p.id === pid)!.color }} />
                      {PLATFORMS.find((p) => p.id === pid)!.name}:{' '}
                      <b>{formatNumber(funnelSplit[pid][idx].value)}</b>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={360}>
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
              <Tooltip content={<FunnelTooltip unit="units" />} cursor={{ stroke: '#c9d2d9', strokeDasharray: '4 4' }} />
              <Line type="monotone" dataKey="visits" name="Перешли в карточку" stroke="#e6448c" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="cart" name="Добавили в корзину" stroke="#7c3aed" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="ordered" name="Заказали" stroke="#14b8a6" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="bought" name="Выкупили" stroke="#3b82f6" strokeWidth={2.2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2-even">
        {PLATFORMS.map((p) => {
          const k = periodKpis([p.id as PlatformId], days);
          return (
            <div className="card" key={p.id}>
              <div className="mp-head" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <PlatformChip id={p.id} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
                    <span className="badge badge-green" style={{ marginTop: 3 }}>Активен</span>
                  </div>
                </div>
                <Link href={`/marketplace/${p.id}`} className="btn btn-outline btn-sm" aria-label={`Открыть ${p.name}`}>
                  <ArrowUpRight size={15} />
                </Link>
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
                  <div className="l">Ср. чек</div>
                  <div className="v">{formatMoney(k.avgCheck.value)}</div>
                  <Delta value={k.avgCheck.change} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Последние заказы</h2>
            <div className="card-sub">Обновлено 5 минут назад</div>
          </div>
          <Link href="/analytics" className="link">Все заказы →</Link>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>№ Заказа</th>
                <th>Площадка</th>
                <th>Товар</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_ORDERS.slice(0, 8).map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 700 }}>{o.id}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <PlatformChip id={o.platform} size={24} />
                      {PLATFORMS.find((p) => p.id === o.platform)?.name}
                    </span>
                  </td>
                  <td>{o.product}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{formatMoney(o.sum)}</td>
                  <td><span className={`badge ${STATUS_BADGE[o.status]}`}>{o.status}</span></td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{formatDate(o.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


    </>
  );
}
