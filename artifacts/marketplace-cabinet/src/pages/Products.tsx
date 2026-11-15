import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Clock3, ExternalLink, ImagePlus, PackagePlus, Pencil, Plus, Save, Search, Trash2, Video } from "lucide-react";
import { deleteCogsProduct, getCogsHistory, listCogsProducts, saveCogsProduct, type CogsMarketplace, type CogsProduct, type CogsHistoryEntry } from "@/lib/cogs-api";

type ProductForm = {
  marketplace: CogsMarketplace; sellerSku: string; productName: string; characteristics: string;
  unit: string; countryOfOrigin: string; brand: string; salePrice: string; unitCost: string;
  description: string; images: string[]; videoUrl: string;
};
const empty: ProductForm = {
  marketplace: "both", sellerSku: "", productName: "", characteristics: "", unit: "шт.",
  countryOfOrigin: "", brand: "", salePrice: "0", unitCost: "0", description: "",
  images: ["", "", "", "", ""], videoUrl: "",
};
const money = (value: string | number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(Number(value || 0));
function readImages(value?: string | string[]): string[] {
  if (Array.isArray(value)) return value.slice(0, 5);
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.slice(0, 5).map(String) : []; }
  catch { return []; }
}
function toForm(product: CogsProduct): ProductForm {
  return {
    marketplace: product.marketplace, sellerSku: product.sellerSku, productName: product.productName,
    characteristics: product.characteristics ?? "", unit: product.unit ?? "шт.",
    countryOfOrigin: product.countryOfOrigin ?? "", brand: product.brand ?? "",
    salePrice: product.salePrice ?? "0", unitCost: product.unitCost,
    description: product.description ?? "", images: [...readImages(product.images), "", "", "", "", ""].slice(0, 5),
    videoUrl: product.videoUrl ?? "",
  };
}
export default function ProductsPage() {
  const [products, setProducts] = useState<CogsProduct[]>([]);
  const [selected, setSelected] = useState<CogsProduct | null>(null);
  const [form, setForm] = useState<ProductForm>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | CogsMarketplace>("all");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<CogsHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true);
    try { setProducts(await listCogsProducts()); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить каталог."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const visible = useMemo(() => products.filter(p => {
    const matchesFilter = filter === "all" || p.marketplace === filter || (filter === "both" && p.marketplace === "both");
    const q = search.trim().toLowerCase();
    return matchesFilter && (!q || [p.productName, p.sellerSku, p.brand ?? ""].some(v => v.toLowerCase().includes(q)));
  }), [products, filter, search]);
  function startNew() { setSelected(null); setEditing(null); setForm(empty); setHistoryOpen(false); setError(""); }
  function startEdit(product: CogsProduct) { setSelected(product); setEditing(product.id); setForm(toForm(product)); setHistoryOpen(false); setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const payload = {
        marketplace: form.marketplace, sellerSku: form.sellerSku, productName: form.productName,
        unitCost: form.unitCost, characteristics: form.characteristics, unit: form.unit,
        countryOfOrigin: form.countryOfOrigin, brand: form.brand, salePrice: form.salePrice,
        description: form.description, images: form.images.filter(v => v.trim()), videoUrl: form.videoUrl,
      };
      const saved = await saveCogsProduct(payload, editing ?? undefined);
      await refresh(); setSelected(saved); setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить товар."); }
    finally { setSaving(false); }
  }
  async function showHistory(product: CogsProduct) {
    try { setHistory(await getCogsHistory(product.id)); setSelected(product); setHistoryOpen(true); setEditing(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить историю."); }
  }
  async function remove(product: CogsProduct) {
    if (!window.confirm(`Удалить «${product.productName}» и историю себестоимости?`)) return;
    try { await deleteCogsProduct(product.id); setSelected(null); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось удалить товар."); }
  }
  const set = (key: keyof ProductForm, value: string) => setForm(current => ({ ...current, [key]: value }));
  const field = (label: string, key: keyof ProductForm, placeholder = "", type = "text") => (
    <div className="field"><label>{label}</label><input className="input" type={type} value={String(form[key])} placeholder={placeholder} onChange={e => set(key, e.target.value)} /></div>
  );
  return <>
    <div className="page-header">
      <div><h1>Товары</h1><div className="subtitle">Единый каталог товаров, себестоимости и размещения на маркетплейсах</div></div>
      <button className="btn btn-primary" onClick={startNew}><Plus size={16}/> Добавить товар</button>
    </div>
    <div className="info-banner">Сейчас можно создать и редактировать внутренние карточки товаров. Подключение импорта, загрузки файлов в хранилище и публикации на Ozon/Wildberries — следующие этапы. Ничего не публикуется без вашего подтверждения.</div>
    {error && <div className="info-banner" role="alert">{error}</div>}
    {selected || editing ? (
      <div className="card">
        <div className="card-head">
          <div><button className="btn btn-outline btn-sm" onClick={() => { setSelected(null); setEditing(null); setHistoryOpen(false); }}><ArrowLeft size={14}/> К каталогу</button><h2 className="card-title" style={{marginTop:12}}>{editing ? "Редактирование карточки" : selected ? selected.productName : "Новый товар"}</h2></div>
          {selected && !editing && <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn btn-outline btn-sm" onClick={() => void showHistory(selected)}><Clock3 size={14}/> История себестоимости</button><button className="btn btn-outline btn-sm" onClick={() => startEdit(selected)}><Pencil size={14}/> Изменить</button><button className="btn btn-danger btn-sm" onClick={() => void remove(selected)}><Trash2 size={14}/> Удалить</button></div>}
        </div>
        {historyOpen && <div style={{padding:12,background:"var(--bg)",borderRadius:10,marginBottom:16}}><strong>История себестоимости</strong>{history.map(item => <div key={item.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 0"}}><span>{new Date(item.effectiveAt).toLocaleString("ru-RU")}</span><b>{money(item.unitCost)}</b></div>)}{!history.length && <p>История пока пуста.</p>}</div>}
        {editing || !selected ? <form onSubmit={submit} style={{display:"grid",gap:16}}>
          <section><h3>Основная информация</h3><div className="grid-2-even">
            {field("Наименование товара", "productName", "Например, коврик для ванной")}
            {field("Артикул продавца / SKU", "sellerSku", "Ваш внутренний артикул")}
            {field("Характеристика", "characteristics", "Размер, цвет, материал")}
            {field("Единица измерения", "unit", "шт.")}
            {field("Страна производства", "countryOfOrigin", "Россия")}
            {field("Бренд", "brand", "Название бренда")}
          </div></section>
          <section><h3>Цены</h3><div className="grid-2-even">
            {field("Цена продажи, ₽", "salePrice", "0.00", "number")}
            {field("Себестоимость за единицу, ₽", "unitCost", "0.00", "number")}
          </div><p className="card-sub">Цена продажи и себестоимость хранятся независимо друг от друга.</p></section>
          <section><h3><ImagePlus size={16} style={{verticalAlign:"middle"}}/> Фотографии товара (до 5)</h3><div className="grid-2-even">
            {form.images.map((url, index) => <div className="field" key={index}><label>Ссылка на изображение {index + 1}</label><input className="input" type="url" placeholder="https://..." value={url} onChange={e => setForm(cur => ({...cur, images: cur.images.map((v,i) => i === index ? e.target.value : v)}))}/></div>)}
          </div><p className="card-sub">Пока сохраняются ссылки на изображения. Загрузка файлов с компьютера появится после подключения постоянного файлового хранилища.</p>
          {form.images.filter(Boolean).length > 0 && <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{form.images.filter(Boolean).map((url,i)=><img key={i} src={url} alt={`Фото товара ${i+1}`} style={{width:88,height:88,objectFit:"cover",borderRadius:8}} onError={e => {e.currentTarget.style.display="none";}}/>)}</div>}</section>
          <section><h3><Video size={16} style={{verticalAlign:"middle"}}/> Видеообзор</h3>{field("Ссылка на видео", "videoUrl", "https://...")}</section>
          <section><h3>Описание</h3><div className="field"><label>Полное описание товара</label><textarea className="input" rows={5} value={form.description} onChange={e => set("description",e.target.value)} placeholder="Описание, преимущества, комплектация..."/></div></section>
          <section><h3>Размещение на площадках</h3><div className="field"><label>Площадка для товара</label><select className="input" value={form.marketplace} onChange={e => set("marketplace",e.target.value)}><option value="both">Ozon и Wildberries (общая карточка)</option><option value="ozon">Только Ozon</option><option value="wildberries">Только Wildberries</option></select></div><p className="card-sub">На этом этапе выбор сохраняется в карточке. Реальная отправка товара на площадки будет добавлена после импорта каталога и проверки обязательных атрибутов API.</p></section>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn btn-primary" type="submit" disabled={saving}><Save size={15}/>{saving ? "Сохраняем…" : "Сохранить товар"}</button><button className="btn btn-outline" type="button" onClick={() => {setSelected(null);setEditing(null);}}>Отмена</button></div>
        </form> : (
          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,2fr)",gap:24}}>
            <div>{readImages(selected.images).length ? <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>{readImages(selected.images).map((url,i)=><img key={i} src={url} alt={selected.productName} style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:10}}/> )}</div> : <div className="empty-state"><ImagePlus size={30}/><p>Фотографии пока не добавлены</p></div>}{selected.videoUrl && <a className="link" href={selected.videoUrl} target="_blank" rel="noreferrer"><Video size={14}/> Открыть видеообзор <ExternalLink size={12}/></a>}</div>
            <div><h2>{selected.productName}</h2><p>{selected.characteristics}</p><div className="grid-2-even"><div><span className="card-sub">Артикул</span><b>{selected.sellerSku}</b></div><div><span className="card-sub">Бренд</span><b>{selected.brand || "—"}</b></div><div><span className="card-sub">Страна</span><b>{selected.countryOfOrigin || "—"}</b></div><div><span className="card-sub">Единица</span><b>{selected.unit || "шт."}</b></div><div><span className="card-sub">Цена продажи</span><b>{money(selected.salePrice ?? 0)}</b></div><div><span className="card-sub">Себестоимость</span><b>{money(selected.unitCost)}</b></div></div><h3>Описание</h3><p style={{whiteSpace:"pre-wrap"}}>{selected.description || "Описание не заполнено."}</p><h3>Площадки</h3><span className="badge badge-blue">{selected.marketplace === "both" ? "Ozon + Wildberries" : selected.marketplace === "ozon" ? "Ozon" : "Wildberries"}</span><p className="card-sub">Статус размещения: черновик. Публикация пока не подключена.</p></div>
          </div>
        )}
      </div>
    ) : <>
      <div className="card" style={{marginBottom:14}}>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{position:"relative",flex:"1 1 240px"}}><Search size={15} style={{position:"absolute",left:12,top:12,color:"var(--muted)"}}/><input className="input" style={{paddingLeft:36}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по названию, артикулу или бренду"/></div>
          <select className="input" style={{width:"auto",minWidth:190}} value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}><option value="all">Все товары</option><option value="both">Общие товары</option><option value="ozon">Ozon</option><option value="wildberries">Wildberries</option></select>
          <span className="badge badge-gray">{visible.length} товаров</span>
        </div>
      </div>
      <div className="card"><div className="card-head"><h2 className="card-title">Каталог товаров</h2></div>
        {loading ? <div className="empty-state">Загружаем каталог…</div> : !visible.length ? <div className="empty-state"><PackagePlus size={32}/><p>Товаров пока нет. Добавьте первую карточку.</p><button className="btn btn-primary" onClick={startNew}>Добавить товар</button></div> :
        <div style={{overflowX:"auto"}}><table className="table"><thead><tr><th>Товар</th><th>Артикул</th><th>Площадки</th><th>Цена</th><th>Себестоимость</th><th>Статус</th><th></th></tr></thead><tbody>{visible.map(product=><tr key={product.id}>
          <td><button className="link" style={{border:0,background:"none",cursor:"pointer",textAlign:"left"}} onClick={()=>{setSelected(product);setHistoryOpen(false);}}>{product.productName}</button></td><td>{product.sellerSku}</td><td>{product.marketplace === "both" ? "Ozon + WB" : product.marketplace === "ozon" ? "Ozon" : "Wildberries"}</td><td>{money(product.salePrice ?? 0)}</td><td><b>{money(product.unitCost)}</b></td><td><span className="badge badge-gray">Черновик</span></td><td><button className="btn btn-outline btn-sm" title="Редактировать" onClick={()=>startEdit(product)}><Pencil size={14}/></button></td>
        </tr>)}</tbody></table></div>}
      </div>
    </>}
  </>;
}
