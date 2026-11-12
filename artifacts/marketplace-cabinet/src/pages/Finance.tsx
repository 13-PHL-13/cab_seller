import { Wallet, Info } from "lucide-react";
import { Link } from "wouter";

export default function FinancePage() {
  return <>
    <div className="page-header"><div><h1>Финансы</h1><div className="subtitle">Балансы, выплаты и движение средств по площадкам</div></div></div>
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="card-head"><div><h2 className="card-title"><Wallet size={18} /> Финансовые данные пока недоступны</h2><div className="card-sub">Мы отключили демонстрационные балансы и операции, чтобы не показывать их как реальные.</div></div></div>
      <div className="info-banner"><Info size={17}/><div>Текущий backend получает агрегированную выручку и воронку продаж, но не реализует отчёты о выплатах, удержаниях, комиссиях и балансе продавца. Для этого нужны отдельные интеграции с финансовыми/отчётными API Ozon и Wildberries.</div></div>
      <Link href="/settings" className="btn btn-primary">Проверить подключения</Link>
    </div>
  </>;
}
