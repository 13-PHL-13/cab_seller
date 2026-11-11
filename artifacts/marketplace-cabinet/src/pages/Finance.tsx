import { useMemo } from 'react';
import { Wallet, Clock, ArrowDownToLine, Percent } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PLATFORMS, BALANCES, TRANSACTIONS, revenueSeries } from '@/data/mock';
import type { TxType } from '@/data/mock';
import { formatMoney, formatDateFull } from '@/lib/format';
import { PlatformChip } from '@/components/ui-bits';

const TX_BADGE: Record<TxType, string> = {
  Продажа: 'badge-green',
  Выплата: 'badge-blue',
  Комиссия: 'badge-orange',
  Логистика: 'badge-gray',
  Реклама: 'badge-purple',
  Возврат: 'badge-red',
};

const shortMoney = (v: number): string => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

export default function FinancePage() {
  const totalBalance = BALANCES.reduce((a, b) => a + b.current, 0);
  const totalNext = BALANCES.reduce((a, b) => a + b.nextPayout, 0);
  const totalPending = BALANCES.reduce((a, b) => a + b.pending, 0);

  const payoutsSeries = useMemo(() => {
    const base = revenueSeries(['ozon', 'wb'], 30);
    return base.map((row) => ({
      label: row.label,
      ozon: row.ozonBought,
      wb: row.wbBought,
    }));
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Финансы</h1>
          <div className="subtitle">Балансы, выплаты и движение средств по площадкам</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Общий баланс</div>
            <div className="kpi-value">{formatMoney(totalBalance)}</div>
          </div>
          <div className="kpi-icon" style={{ background: '#e3f2ec', color: '#0e7a62' }}><Wallet size={17} /></div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Ожидаемая выплата</div>
            <div className="kpi-value">{formatMoney(totalNext)}</div>
          </div>
          <div className="kpi-icon" style={{ background: '#e3edff', color: '#1d4ed8' }}><Clock size={17} /></div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">К удержанию</div>
            <div className="kpi-value">{formatMoney(totalPending)}</div>
          </div>
          <div className="kpi-icon" style={{ background: '#fef3e2', color: '#b45309' }}><Percent size={17} /></div>
        </div>
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Выплачено за период</div>
            <div className="kpi-value">{formatMoney(BALANCES.reduce((a, b) => a + b.lastPayout, 0))}</div>
          </div>
          <div className="kpi-icon" style={{ background: '#f3e8ff', color: '#7e22ce' }}><ArrowDownToLine size={17} /></div>
        </div>
      </div>

      <div className="grid-2-even">
        {BALANCES.map((b) => {
          const p = PLATFORMS.find((x) => x.id === b.platform)!;
          return (
            <div className="card" key={b.platform}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <PlatformChip id={b.platform} />
                <div style={{ fontWeight: 800, fontSize: 15 }}>{p.name}</div>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>Текущий баланс</div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>{formatMoney(b.current)}</div>
              <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {b.nextPayoutDays === 1 ? 'Выплатим завтра' : `Выплатим через ${b.nextPayoutDays} дня`}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{formatMoney(b.nextPayout)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>К удержанию</div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{formatMoney(b.pending)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Последняя выплата</div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{formatMoney(b.lastPayout)}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{formatDateFull(b.lastPayoutDate)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">Поступления по площадкам</h2>
            <div className="card-sub">Фактические продажи, ₽ за 30 дней</div>
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
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={payoutsSeries} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {PLATFORMS.map((p) => (
                <linearGradient key={p.id} id={`grad-fin-${p.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={p.color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={p.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="4 6" stroke="#edf0f3" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tickFormatter={shortMoney} tickLine={false} axisLine={false} width={44} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} />
            {PLATFORMS.map((p) => (
              <Area key={p.id} type="monotone" dataKey={p.id} name={p.name} stroke={p.color} strokeWidth={2.2} fill={`url(#grad-fin-${p.id})`} dot={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Движение средств</h2>
            <div className="card-sub">Последние операции</div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Операция</th>
                <th>Тип</th>
                <th>Площадка</th>
                <th>Дата</th>
                <th style={{ textAlign: 'right' }}>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {TRANSACTIONS.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 700 }}>{t.id}</td>
                  <td><span className={`badge ${TX_BADGE[t.type]}`}>{t.type}</span></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <PlatformChip id={t.platform} size={24} />
                      {PLATFORMS.find((p) => p.id === t.platform)?.name}
                    </span>
                  </td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{formatDateFull(t.date)}</td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: t.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {t.amount >= 0 ? '+' : '−'}{formatMoney(Math.abs(t.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

