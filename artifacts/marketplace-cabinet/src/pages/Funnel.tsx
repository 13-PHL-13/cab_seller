import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { funnelSeries, funnelStages, funnelStagesByPlatform, PLATFORMS, logDomain, logTicks } from '@/data/mock';
import type { FunnelUnit, PlatformId } from '@/data/mock';
import { formatMoney, formatNumber } from '@/lib/format';
import { MiniDelta } from '@/components/ui-bits';
import { FunnelTooltip } from '@/components/FunnelTooltip';

const PERIODS = [
  { key: 'week', label: 'Неделя', days: 7 },
  { key: 'month', label: 'Месяц', days: 30 },
  { key: 'quarter', label: 'Квартал', days: 90 },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

type PlatformFilter = 'all' | PlatformId;

export default function FunnelPage() {
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const [unit, setUnit] = useState<FunnelUnit>('units');

  const days = PERIODS.find((p) => p.key === period)!.days;
  const platforms: PlatformId[] = platform === 'all' ? ['ozon', 'wb'] : [platform];

  const stages = useMemo(() => funnelStages(platforms, days, unit), [platform === 'all', days, unit]);
  const series = useMemo(() => funnelSeries(platforms, days, unit, granularity), [platform === 'all', days, unit, granularity]);
  const yDomain = useMemo(
    () => logDomain(series.flatMap((p) => [p.visits, p.cart, p.ordered, p.bought])),
    [series],
  );
  const yTicks = useMemo(() => logTicks(yDomain), [yDomain]);
  const split = useMemo(() => funnelStagesByPlatform(platforms, days, unit), [platform === 'all', days, unit]);

  const fmt = (v: number) => (unit === 'rub' ? formatMoney(v) : formatNumber(v));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Воронка продаж</h1>
          <div className="subtitle">
            Переходы в карточку и добавление в корзину{platform === 'all' ? ' по всем площадкам' : ` — ${PLATFORMS.find((p) => p.id === platform)!.name}`}, лог. шкала
          </div>
        </div>
        <div className="header-actions">
          <div className="select-wrap">
            <select className="select" value={platform} onChange={(e) => setPlatform(e.target.value as PlatformFilter)} style={{ width: 190 }}>
              <option value="all">Все площадки</option>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="segmented">
            <button className={granularity === 'day' ? 'active' : ''} onClick={() => setGranularity('day')}>По дням</button>
            <button className={granularity === 'week' ? 'active' : ''} onClick={() => setGranularity('week')}>По неделям</button>
          </div>
          <div className="segmented">
            <button className={unit === 'units' ? 'active' : ''} onClick={() => setUnit('units')}>Штуки</button>
            <button className={unit === 'rub' ? 'active' : ''} onClick={() => setUnit('rub')}>Рубли</button>
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

      <div className="card">
        <div className="funnel-layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stages.map((s, idx) => (
              <div className="funnel-stage active" key={s.key}>
                <div className="stage-name">
                  <span className="stage-check" style={{ background: s.color }}>
                    <Check size={12} />
                  </span>
                  {s.name}
                </div>
                <div className="stage-value">
                  {unit === 'rub' ? formatMoney(s.value) : formatNumber(s.value)}
                  <MiniDelta value={s.change} />
                </div>
                {s.note ? <div className="stage-note">{s.note}</div> : null}
                {platform === 'all' ? (
                  <div className="stage-split">
                    {platforms.map((pid) => (
                      <span key={pid}>
                        <span className="tt-dot" style={{ background: PLATFORMS.find((p) => p.id === pid)!.color }} />
                        {PLATFORMS.find((p) => p.id === pid)!.name}:{' '}
                        <b>{unit === 'rub' ? formatMoney(split[pid][idx].value) : formatNumber(split[pid][idx].value)}</b>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#eef1f4" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={26} />
              <YAxis
                scale="log"
                domain={yDomain}
                allowDataOverflow
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v: number) => (unit === 'rub' ? `${Math.round(v / 1000)}k` : formatNumber(v))}
                ticks={yTicks}
              />
              <Tooltip content={<FunnelTooltip unit={unit} />} cursor={{ stroke: '#c9d2d9', strokeDasharray: '4 4' }} />
              <Line type="monotone" dataKey="visits" name="Перешли в карточку" stroke="#e6448c" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="cart" name="Добавили в корзину" stroke="#7c3aed" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="ordered" name="Заказали" stroke="#14b8a6" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="bought" name="Выкупили" stroke="#3b82f6" strokeWidth={2.2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
