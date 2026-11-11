import { formatMoney, formatNumber } from '@/lib/format';
import { PLATFORMS, platformById } from '@/data/mock';
import type { FunnelPoint, FunnelUnit } from '@/data/mock';

export const FUNNEL_STAGES = [
  { key: 'visits', name: 'Перешли в карточку', color: '#e6448c' },
  { key: 'cart', name: 'Добавили в корзину', color: '#7c3aed' },
  { key: 'ordered', name: 'Заказали', color: '#14b8a6' },
  { key: 'bought', name: 'Выкупили', color: '#3b82f6' },
] as const;

type StageName = (typeof FUNNEL_STAGES)[number]['key'];

interface FunnelTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: FunnelPoint }>;
  label?: string | number;
  unit: FunnelUnit;
  /** Компонент используется только когда в данных есть разбивка. */
  split?: boolean;
}

/** Подсказка воронки: сумма по стадии + разбивка по магазинам. */
export function FunnelTooltip({ active, payload, label, unit, split = true }: FunnelTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as FunnelPoint;
  const fmt = (v: number) => (unit === 'rub' ? formatMoney(v) : formatNumber(v));
  const platformIds = point.byPlatform ? Object.keys(point.byPlatform) : [];

  return (
    <div className="funnel-tooltip">
      <div className="tt-date">{label}</div>
      {FUNNEL_STAGES.map((s) => {
        const total = point[s.key];
        const hasSplit = split && platformIds.length > 1 && point.byPlatform;
        return (
          <div className="tt-row" key={s.key}>
            <span style={{ color: s.color, fontWeight: 700 }}>
              {s.name}:{' '}
              <span style={{ color: 'var(--text)' }}>{fmt(total)}</span>
            </span>
            {hasSplit ? (
              <span className="tt-split">
                {platformIds.map((pid) => (
                  <span key={pid}>
                    <span className="tt-dot" style={{ background: platformById(pid)?.color }} />
                    {platformById(pid)?.name}: <b>{fmt(point.byPlatform![pid][s.key as StageName])}</b>
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        );
      })}
      {split && platformIds.length > 1 ? (
        <div className="tt-note">Разбивка: {PLATFORMS.filter((p) => platformIds.includes(p.id)).map((p) => p.name).join(' + ')}</div>
      ) : null}
    </div>
  );
}
