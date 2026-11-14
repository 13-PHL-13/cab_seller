import { useEffect, useState, type FormEvent } from "react";
import { Clock3, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { deleteCogsProduct, getCogsHistory, listCogsProducts, saveCogsProduct, type CogsHistoryEntry, type CogsMarketplace, type CogsProduct } from "@/lib/cogs-api";

const money = (value: string | number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(Number(value));
const emptyForm = { marketplace: "both" as CogsMarketplace, sellerSku: "", productName: "", unitCost: "" };

export default function CogsPage() {
  const [products, setProducts] = useState<CogsProduct[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, CogsHistoryEntry[]>>({});
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setProducts(await listCogsProducts()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить товары."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  function beginEdit(product: CogsProduct) {
    setEditing(product.id);
    setForm({ marketplace: product.marketplace, sellerSku: product.sellerSku, productName: product.productName, unitCost: product.unitCost });
    setError("");
  }
  function cancelEdit() { setEditing(null); setForm(emptyForm); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await saveCogsProduct(form, editing ?? undefined);
      cancelEdit();
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить себестоимость."); }
    finally { setSaving(false); }
  }

  async function remove(product: CogsProduct) {
    if (!window.confirm(`Удалить «${product.productName}» и историю его себестоимости?`)) return;
    try { await deleteCogsProduct(product.id); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить товар."); }
  }

  async function toggleHistory(id: string) {
    if (historyOpen === id) { setHistoryOpen(null); return; }
    try {
      setHistory((current) => ({ ...current, [id]: await getCogsHistory(id) }));
      setHistoryOpen(id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю."); }
  }

  return <>
    <div className="page-header"><div><h1>Себестоимость товаров</h1><div className="subtitle">Личный справочник закупочной стоимости по артикулам</div></div></div>
    <div className="info-banner">Себестоимость хранится отдельно для каждого аккаунта. Изменения цены сохраняются в истории. Пока это справочник: автоматическое сопоставление с заказами и расчёт чистой прибыли будут следующим этапом.</div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head"><h2 className="card-title">{editing ? "Изменить товар" : "Добавить товар"}</h2></div>
      <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, alignItems: "end" }}>
        <div className="field"><label htmlFor="cogs-marketplace">Площадка</label><select id="cogs-marketplace" className="input" value={form.marketplace} onChange={(e) => setForm({ ...form, marketplace: e.target.value as CogsMarketplace })}><option value="both">Общий артикул</option><option value="ozon">Ozon</option><option value="wildberries">Wildberries</option></select></div>
        <div className="field"><label htmlFor="cogs-sku">Артикул продавца / SKU</label><input id="cogs-sku" className="input" value={form.sellerSku} onChange={(e) => setForm({ ...form, sellerSku: e.target.value })} maxLength={120} required /></div>
        <div className="field"><label htmlFor="cogs-name">Название товара</label><input id="cogs-name" className="input" value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} maxLength={240} required /></div>
        <div className="field"><label htmlFor="cogs-cost">Себестоимость за единицу, ₽</label><input id="cogs-cost" className="input" type="number" min="0" max="999999999999.99" step="0.01" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} required /></div>
        <div style={{ display: "flex", gap: 8 }}><button className="btn btn-primary" type="submit" disabled={saving}><Save size={15} />{saving ? "Сохраняем…" : "Сохранить"}</button>{editing ? <button className="btn btn-outline" type="button" onClick={cancelEdit}><X size={15} />Отмена</button> : null}</div>
      </form>
      {error ? <div className="info-banner" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
    <div className="card">
      <div className="card-head"><h2 className="card-title">Мои товары</h2><span className="badge badge-gray">{products.length}</span></div>
      {loading ? <div className="empty-state">Загружаем справочник…</div> : products.length === 0 ? <div className="empty-state">Пока нет товаров. Добавьте первый артикул и его себестоимость выше.</div> : <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}><thead><tr>{["Площадка","Артикул","Товар","Себестоимость","Изменён","Действия"].map((label) => <th key={label} style={{ padding: 10, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{label}</th>)}</tr></thead>
          <tbody>{products.map((product) => <tr key={product.id}>
            <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{product.marketplace === "both" ? "Общий" : product.marketplace === "ozon" ? "Ozon" : "Wildberries"}</td>
            <td style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{product.sellerSku}</td>
            <td style={{ padding: 10, borderBottom: "1px solid var(--border)", minWidth: 160 }}>{product.productName}</td>
            <td style={{ padding: 10, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", fontWeight: 700 }}>{money(product.unitCost)}</td>
            <td style={{ padding: 10, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{new Date(product.updatedAt).toLocaleDateString("ru-RU")}</td>
            <td style={{ padding: 10, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
              <button className="btn btn-outline btn-sm" title="История себестоимости" onClick={() => void toggleHistory(product.id)}><Clock3 size={14} /></button>{" "}
              <button className="btn btn-outline btn-sm" title="Изменить" onClick={() => beginEdit(product)}><Pencil size={14} /></button>{" "}
              <button className="btn btn-outline btn-sm" title="Удалить" onClick={() => void remove(product)}><Trash2 size={14} /></button>
            </td>
          </tr>)}{historyOpen && history[historyOpen] ? <tr><td colSpan={6} style={{ padding: 12, background: "var(--surface-muted)" }}><strong>История изменения себестоимости</strong>{history[historyOpen].map((entry) => <div key={entry.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span>{new Date(entry.effectiveAt).toLocaleString("ru-RU")}</span><strong>{money(entry.unitCost)}</strong></div>)}</td></tr> : null}</tbody>
        </table>
      </div>}
    </div>
  </>;
}
