import { TrendingDown, TrendingUp } from 'lucide-react';
type PlatformId = 'ozon' | 'wb';
type OrderStatus = 'Доставлен' | 'В пути' | 'Собирается' | 'Отменён';

const PLATFORMS = [
  { id: 'ozon', name: 'Ozon', color: '#005BFF', initial: 'O' },
  { id: 'wb', name: 'Wildberries', color: '#A73AFD', initial: 'W' },
] as const;

/** Цветной чип площадки (O / W). */
export function PlatformChip({ id, size = 34 }: { id: PlatformId; size?: number }) {
  const p = PLATFORMS.find((x) => x.id === id);
  if (!p) return null;
  return (
    <span
      className="chip"
      style={{ background: p.color, width: size, height: size, fontSize: size * 0.44 }}
    >
      {p.initial}
    </span>
  );
}

export function Delta({ value, reverse = false }: { value: number; reverse?: boolean }) {
  const good = reverse ? value < 0 : value > 0;
  const Icon = good ? TrendingUp : TrendingDown;
  return (
    <span className={`kpi-delta ${good ? 'delta-up' : 'delta-down'}`} style={{ marginTop: 0 }}>
      <Icon size={14} />
      {value > 0 ? '+' : ''}
      {value.toFixed(1).replace('.', ',')}%
      <span className="vs">vs прошлый период</span>
    </span>
  );
}

export function MiniDelta({ value }: { value: number }) {
  return (
    <span className={`mini-delta ${value >= 0 ? 'up' : 'down'}`}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value).toFixed(0)}%
    </span>
  );
}

export const STATUS_BADGE: Record<OrderStatus, string> = {
  Доставлен: 'badge-green',
  'В пути': 'badge-blue',
  Собирается: 'badge-orange',
  Отменён: 'badge-red',
};

/** Страница не найдена. */
export function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="icon">{icon}</div>
      <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 13 }}>{text}</div>
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}
