import { useState, type FormEvent } from "react";
import { AlertTriangle, Info, RefreshCw, Wallet } from "lucide-react";
import { Link } from "wouter";
import {
  formatApiError,
  getWildberriesFinanceReport,
} from "@/lib/marketplace-api";
import type { WildberriesFinanceReport } from "@/lib/marketplace-api";

function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function amountLabel(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const ITEMS: Array<{
  key: keyof WildberriesFinanceReport["totals"];
  label: string;
  description: string;
}> = [
  { key: "retailAmount", label: "Реализовано по отчёту", description: "Сумма реализации и возвратов по строкам отчёта" },
  { key: "sellerPayout", label: "К перечислению продавцу", description: "Поле ppvzForPay из отчёта реализации" },
  { key: "delivery", label: "Логистика", description: "Начисления и корректировки доставки" },
  { key: "storage", label: "Хранение", description: "Начисления за хранение" },
  { key: "acceptance", label: "Приёмка", description: "Начисления за приёмку товаров" },
  { key: "penalties", label: "Штрафы", description: "Сумма поля penalty, знак сохраняется как в API" },
  { key: "additionalPayments", label: "Дополнительные начисления", description: "Поле additionalPayment" },
  { key: "deductions", label: "Удержания", description: "Поле deduction" },
  { key: "acquiring", label: "Эквайринг", description: "Комиссия за приём платежей" },
  { key: "marketplaceReward", label: "Вознаграждение WB", description: "Поле ppvzReward из отчёта" },
];

export default function FinancePage() {
  const [from, setFrom] = useState(() => localDate(-6));
  const [to, setTo] = useState(() => localDate());
  const [report, setReport] = useState<WildberriesFinanceReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const result = await getWildberriesFinanceReport(from, to);
      setReport(result);
    } catch (reason) {
      setError(formatApiError(reason));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Финансы</h1>
          <div className="subtitle">Финансовые показатели по отчётам реализации маркетплейсов</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div>
            <h2 className="card-title"><Wallet size={18} /> Отчёт Wildberries</h2>
            <div className="card-sub">Детализация отчёта реализации из Finance API</div>
          </div>
          <span className="badge badge-green">API</span>
        </div>
        <form onSubmit={loadReport} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="finance-from">Дата начала</label>
            <input id="finance-from" className="input" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} required />
          </div>
          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="finance-to">Дата окончания</label>
            <input id="finance-to" className="input" type="date" value={to} min={from} max={localDate()} onChange={(event) => setTo(event.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading || !from || !to || from > to}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            {loading ? "Загружаем…" : "Загрузить отчёт"}
          </button>
        </form>
        <div className="info-banner" style={{ marginTop: 14 }}>
          <Info size={17} />
          <div>
            Для Wildberries нужен API-ключ с правами категории «Финансы». Запрос выполняется только по нажатию кнопки, без фонового опроса. Если площадка вернёт ограничение частоты, дождитесь разрешения повторного запроса.
          </div>
        </div>
        {error ? <div className="info-banner" role="alert"><AlertTriangle size={17} />{error}</div> : null}
      </div>

      {report ? (
        <>
          <div className="page-header">
            <div>
              <h2>Результат отчёта</h2>
              <div className="subtitle">{report.from} — {report.to} · строк: {report.rowsCount}{report.currency ? ` · валюта API: ${report.currency}` : ""}</div>
            </div>
          </div>
          {report.incomplete ? (
            <div className="info-banner" role="status">
              <AlertTriangle size={17} />
              Получено 100 000 строк — возможна неполная выборка. Автоматическая пагинация пока не включена, чтобы не нарушать ограничения частоты Finance API.
            </div>
          ) : null}
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            {ITEMS.slice(0, 4).map((item) => (
              <div className="kpi-card" key={item.key}>
                <div>
                  <div className="kpi-label">{item.label}</div>
                  <div className="kpi-value">{amountLabel(report.totals[item.key])}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Расшифровка начислений</h2>
                <div className="card-sub">Суммы рассчитаны суммированием одноимённых полей строк API</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
              {ITEMS.slice(4).map((item) => (
                <div key={item.key} style={{ border: "1px solid var(--border)", borderRadius: 9, padding: 12 }}>
                  <div className="kpi-label">{item.label}</div>
                  <div style={{ fontSize: 19, fontWeight: 700, margin: "5px 0" }}>{amountLabel(report.totals[item.key])}</div>
                  <div className="card-sub">{item.description}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="info-banner" style={{ marginTop: 14 }}>
            <Info size={17} />
            <div>
              Это суммы из отчёта реализации, а не чистая прибыль и не гарантированная сумма ближайшей выплаты. Себестоимость, налоги, рекламные расходы, возвраты вне выбранного отчёта и прочие расходы продавца здесь отдельно не рассчитываются.
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <div className="empty-state">
            {loading ? "Запрашиваем отчёт у Wildberries…" : "Выберите период и нажмите «Загрузить отчёт». Данные появятся здесь после успешного ответа API."}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">Ozon</h2>
            <div className="card-sub">Интеграция финансовых начислений готовится отдельно</div>
          </div>
          <span className="badge">Не подключено</span>
        </div>
        <div className="info-banner">
          <Info size={17} />
          <div>
            Старые методы Ozon /v3/finance/transaction/list и totals отключены 8 сентября 2026 года. Для новой интеграции требуется последовательная работа с /v1/finance/accrual/postings, /types и /by-day. Мы не используем отключённые методы и не подставляем вместо финансовых данных аналитику продаж.
          </div>
        </div>
        <Link href="/settings" className="link">Настройки подключений →</Link>
      </div>
    </>
  );
}
