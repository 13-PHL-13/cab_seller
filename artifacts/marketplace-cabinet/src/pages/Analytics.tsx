import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PLATFORMS, PRODUCTS, periodKpis, unitsSeries, revenueSeries } from '@/data/mock';
import { formatMoney, formatNumber } from '@/lib/format';
import { PlatformChip, Delta } from '@/components/ui-bits';

const PERIODS = [
  { key: 'week', label: 'Неделя', days: 7 },
  { key: 'month', label: 'Месяц', days: 30 },
  { key: 'quarter', label: 'Квартал', days: 90 },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [metric, setMetric] = useState<'units' | 'rub'>('units');
  const days = PERIODS.find((p) => p.key === period)!.days;

  const kpis = useMemo(() => periodKpis(['ozon', 'wb'], days), [days]);
  const data = useMemo(() => {
    const base = metric === 'units' ? unitsSeries(['ozon', 'wb'], days) : revenueSeries(['ozon', 'wb'], days);
    return base.map((row) => ({
      ...row,
      ozon: metric === 'units' ? row.ozon : row.ozonBought,
      wb: metric === 'units' ? row.wb : row.wbBought,
      total: Number(row.ozon) + Number(row.wb),
    }));
  }, [metric, days]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of PRODUCTS) map.set(p.category, (map.get(p.category) ?? 0) + p.revenue);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const maxCategory = categories[0]?.[1] ?? 1;
  const boughtUnits = useMemo(() => {
    const s = unitsSeries(['ozon', 'wb'], days);
    return s.reduce((a, r) => a + Number(r.total), 0);
  }, [days]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Аналитика</h1>
          <div className="subtitle">Фактические продажи и товары по всем площадкам</div>
        </div>
        <div className="header-actions">
          <div className="segmented">
            <button className={metric === 'units' ? 'active' : ''} onClick={() => setMetric('units')}>Штуки</button>
            <button className={metric === 'rub' ? 'active' : ''} onClick={() => setMetric('rub')}>Рубли</button>
          </div>
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
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Фактические продажи</div>
            <div className="kpi-value">{formatMoney(kpis.boughtRevenue.value)}</div>
            <Delta value={kpis.boughtRevenue.change} />
          </div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Выкуплено, шт</div>
            <div className="kpi-value">{formatNumber(boughtUnits)}</div>
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
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">Фактические продажи</h2>
            <div className="card-sub">{metric === 'units' ? 'Выкуплено, шт' : 'Выкуплено, ₽'} — с учётом возвратов</div>
          </div>
          <div className="chart-legend">
            {PLATFORMS.map((p) => (
              <span className="item" key={p.id}>
                <span className="dot" style={{ background: p.color }} />
                {p.name}
              </span>
            ))}
            <span className="item">
              <span className="dot" style={{ background: '#16232e' }} />
              Всего
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 6" stroke="#edf0f3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (metric === 'rub' ? `${Math.round(v / 1000)}k` : formatNumber(v))} />
            <Tooltip formatter={(v) => (metric === 'rub' ? formatMoney(Number(v)) : formatNumber(Number(v)))} />
            {PLATFORMS.map((p) => (
              <Line key={p.id} type="monotone" dataKey={p.id} name={p.name} stroke={p.color} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
            ))}
            <Line type="monotone" dataKey="total" name="Всего" stroke="#16232e" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid-2-even">
        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Топ товаров</h2>
              <div className="card-sub">Все площадки, по выручке</div>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Площадка</th>
                  <th>Заказы</th>
                  <th>Выручка</th>
                </tr>
              </thead>
              <tbody>
                {[...PRODUCTS].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td><PlatformChip id={p.platform} size={22} /></td>
                    <td className="num">{formatNumber(p.orders)}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{formatMoney(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Продажи по категориям</h2>
              <div className="card-sub">Выручка, ₽</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {categories.map(([name, revenue]) => (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  <span>{name}</span>
                  <span className="num" style={{ color: 'var(--muted)' }}>{formatMoney(revenue)}</span>
                </div>
                <div className="progress">
                  <div style={{ width: `${(revenue / maxCategory) * 100}%`, background: 'var(--brand)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
