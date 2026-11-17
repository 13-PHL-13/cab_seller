import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, Clock3, Download, ExternalLink, ImagePlus, PackagePlus, Pencil, Plus, Save, Search, Trash2, Video } from "lucide-react";
import {
  deleteCogsProduct,
  deleteProductMedia,
  getCogsHistory,
  importMarketplaceProducts,
  publishCogsProduct,
  listCogsProducts,
  saveCogsProduct,
  uploadProductImages,
  uploadProductVideo,
  uploadWildberriesProductMedia,
  getOzonCategoryTypes,
  getOzonCategoryAttributes,
  searchOzonAttributeValues,
  searchWildberriesSubjects,
  getWildberriesSubjectCharacteristics,
  type CogsMarketplace,
  type CogsProduct,
  type CogsHistoryEntry,
  type MarketplaceAttribute,
  type OzonAttributeValue,
  type OzonCategoryType,
  type WildberriesSubject,
} from "@/lib/cogs-api";

type ProductForm = {
  marketplaces: Array<"ozon" | "wildberries">; marketplaceSkus: Partial<Record<"ozon" | "wildberries", string>>; sellerSku: string; productName: string; characteristics: string;
  unit: string; countryOfOrigin: string; brand: string; salePrice: string; unitCost: string;
  description: string; images: string[]; videoUrl: string;
};
const empty: ProductForm = {
  marketplaces: ["ozon", "wildberries"], marketplaceSkus: {}, sellerSku: "", productName: "", characteristics: "", unit: "шт.",
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
    marketplaces: product.marketplaces?.map((item) => item.marketplace) ?? (product.marketplace === "both" ? ["ozon", "wildberries"] : [product.marketplace]), marketplaceSkus: Object.fromEntries((product.marketplaces ?? []).map(item => [item.marketplace, item.marketplaceSku])), sellerSku: product.sellerSku, productName: product.productName,
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
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"all" | CogsMarketplace>("all");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<CogsHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [importing, setImporting] = useState<"ozon" | "wildberries" | null>(null);
  const [publishing, setPublishing] = useState<"ozon" | "wildberries" | null>(null);
  const [publishTarget, setPublishTarget] = useState<{ product: CogsProduct; marketplace: "ozon" | "wildberries" } | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishSearch, setPublishSearch] = useState("");
  const [ozonCategoryTypes, setOzonCategoryTypes] = useState<OzonCategoryType[]>([]);
  const [wbSubjects, setWbSubjects] = useState<WildberriesSubject[]>([]);
  const [selectedCategoryType, setSelectedCategoryType] = useState("");
  const [selectedWbSubject, setSelectedWbSubject] = useState("");
  const [publishAttributes, setPublishAttributes] = useState<MarketplaceAttribute[]>([]);
  const [publishAttributeJson, setPublishAttributeJson] = useState("[]");
  const [ozonDictionarySearch, setOzonDictionarySearch] = useState<Record<number, string>>({});
  const [ozonDictionaryOptions, setOzonDictionaryOptions] = useState<Record<number, OzonAttributeValue[]>>({});
  const [ozonDictionaryBusy, setOzonDictionaryBusy] = useState<number | null>(null);
  const [publishError, setPublishError] = useState("");

  useEffect(() => {
    const urls = imageFiles.map((file) => URL.createObjectURL(file));
    setImagePreviews(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageFiles]);
  function handleImageFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!files.length) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    const invalidFile = files.find(
      (file) => !allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024,
    );

    if (invalidFile) {
      setError("Выберите JPG, PNG или WebP размером не более 10 МБ каждый.");
      return;
    }

    const existingCount = form.images.filter((url) => url.trim()).length;
    const remaining = 5 - existingCount - imageFiles.length;

    if (files.length > remaining) {
      setError(`Можно добавить ещё ${Math.max(0, remaining)} фотографий. Максимум — 5.`);
      return;
    }

    setError("");
    setImageFiles((current) => [...current, ...files]);
  }
  function handleVideoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) return;

    const allowedTypes = ["video/mp4", "video/webm"];

    if (!allowedTypes.includes(file.type) || file.size > 100 * 1024 * 1024) {
      setError("Выберите видео MP4 или WebM размером не более 100 МБ.");
      return;
    }

    setError("");
    setVideoFile(file);
  }
  async function refresh() {
    setLoading(true);
    try { const rows = await listCogsProducts(); setProducts(rows); setError(""); return rows; }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить каталог."); return []; }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const visible = useMemo(() => products.filter(p => {
    const linked = p.marketplaces?.map((item) => item.marketplace) ?? (p.marketplace === "both" ? ["ozon", "wildberries"] : [p.marketplace]);
    const matchesFilter = filter === "all" || (filter === "both" ? linked.length === 2 : linked.includes(filter));
    const q = search.trim().toLowerCase();
    return matchesFilter && (!q || [p.productName, p.sellerSku, p.brand ?? ""].some(v => v.toLowerCase().includes(q)));
  }), [products, filter, search]);
    function startNew() {
    setSelected(null);
    setEditing(null);
    setCreating(true);
    setForm(empty);
    setImageFiles([]);
    setVideoFile(null);
    setHistoryOpen(false);
    setError("");
  }

  function startEdit(product: CogsProduct) {
    setSelected(product);
    setEditing(product.id);
    setCreating(false);
    setForm(toForm(product));
    setImageFiles([]);
    setVideoFile(null);
    setHistoryOpen(false);
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.marketplaces.length) { setError("Выберите хотя бы одну площадку для товара."); return; }
    setSaving(true); setError("");
    try {
      const payload = {
        marketplace: (form.marketplaces.length === 2 ? "both" : form.marketplaces[0]) as CogsMarketplace, marketplaces: form.marketplaces, marketplaceSkus: form.marketplaceSkus,
        sellerSku: form.sellerSku, productName: form.productName,
        unitCost: form.unitCost, characteristics: form.characteristics, unit: form.unit,
        countryOfOrigin: form.countryOfOrigin, brand: form.brand, salePrice: form.salePrice,
        description: form.description, images: form.images.filter(v => v.trim()), videoUrl: form.videoUrl,
      };
      let saved = await saveCogsProduct(payload, editing ?? undefined);

      setSelected(saved);
      setEditing(saved.id);
      setForm(toForm(saved));

      if (imageFiles.length > 0) {
        saved = await uploadProductImages(saved.id, imageFiles);
        setImageFiles([]);
        setSelected(saved);
        setForm(toForm(saved));
      }

      if (videoFile) {
        saved = await uploadProductVideo(saved.id, videoFile);
        setVideoFile(null);
        setSelected(saved);
        setForm(toForm(saved));
      }

      const refreshed = await refresh();
      saved = refreshed.find((product) => product.id === saved.id) ?? saved;
      setSelected(saved);
      setEditing(null);
      setCreating(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить товар."); }
    finally { setSaving(false); }
  }
  async function removeImage(index: number) {
    const url = form.images[index];
    const productId = editing ?? selected?.id;

    if (!url) return;

    const filename = productId
      ? url.match(new RegExp(`^/api/cogs/${productId}/media/([^/?#]+)$`))?.[1]
      : undefined;

    try {
      if (filename && productId) {
        const updated = await deleteProductMedia(productId, "image", filename);

        setSelected((current) =>
          current?.id === updated.id ? updated : current,
        );
        setProducts((current) =>
          current.map((product) =>
            product.id === updated.id ? updated : product,
          ),
        );
      }

      setForm((current) => ({
        ...current,
        images: current.images.map((value, i) => i === index ? "" : value),
      }));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить фотографию.");
    }
  }
  async function removeVideo() {
    const url = form.videoUrl;
    const productId = editing ?? selected?.id;

    if (!url) return;

    const filename = productId
      ? url.match(new RegExp(`^/api/cogs/${productId}/media/([^/?#]+)$`))?.[1]
      : undefined;

    try {
      if (filename && productId) {
        const updated = await deleteProductMedia(productId, "video", filename);

        setSelected((current) =>
          current?.id === updated.id ? updated : current,
        );
        setProducts((current) =>
          current.map((product) =>
            product.id === updated.id ? updated : product,
          ),
        );
      }

      setForm((current) => ({ ...current, videoUrl: "" }));
      setVideoFile(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить видео.");
    }
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
  async function importProducts(marketplace: "ozon" | "wildberries") {
    setImporting(marketplace); setError("");
    try {
      const result = await importMarketplaceProducts(marketplace);
      await refresh();
      window.alert(`Импорт завершён: добавлено ${result.imported}, уже были в каталоге ${result.existing}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось импортировать товары."); }
    finally { setImporting(null); }
  }
  async function publishProduct(product: CogsProduct, marketplace: "ozon" | "wildberries") {
    setPublishTarget({ product, marketplace });
    setPublishSearch(product.productName);
    setOzonCategoryTypes([]); setWbSubjects([]);
    setSelectedCategoryType(""); setSelectedWbSubject("");
    setPublishAttributes([]); setPublishAttributeJson("[]"); setPublishError("");
    if (marketplace === "ozon") {
      setPublishBusy(true);
      try {
        const result = await getOzonCategoryTypes();
        setOzonCategoryTypes(result.categories);
        if (!result.categories.length) setPublishError("Ozon не вернул доступных категорий. Проверьте права API-ключа.");
      } catch (e) { setPublishError(e instanceof Error ? e.message : "Не удалось загрузить категории Ozon."); }
      finally { setPublishBusy(false); }
    }
  }

  async function searchPublishSubjects() {
    setPublishBusy(true); setPublishError(""); setWbSubjects([]); setSelectedWbSubject(""); setPublishAttributes([]);
    try {
      const result = await searchWildberriesSubjects(publishSearch.trim());
      setWbSubjects(result.subjects);
      if (!result.subjects.length) setPublishError("Предметы по этому запросу не найдены.");
    } catch (e) { setPublishError(e instanceof Error ? e.message : "Не удалось найти предмет Wildberries."); }
    finally { setPublishBusy(false); }
  }

  async function selectPublishCategory(value: string) {
    setSelectedCategoryType(value); setPublishAttributes([]); setPublishAttributeJson("[]"); setPublishError("");
    setOzonDictionarySearch({}); setOzonDictionaryOptions({});
    const [categoryId, typeId] = value.split(":").map(Number);
    if (!categoryId || !typeId) return;
    setPublishBusy(true);
    try {
      const result = await getOzonCategoryAttributes(categoryId, typeId);
      setPublishAttributes(result.attributes);
      const required = result.attributes.filter((item) => item.is_required === true || item.required === true);
      const template = [
        ...required.filter((item) => Number(item.id) !== 8229).map((item) => ({
          id: Number(item.id),
          complex_id: Number(item.attribute_complex_id ?? item.complex_id ?? 0),
          values: [Number(item.dictionary_id) > 0 ? { dictionary_value_id: 0 } : { value: "" }],
        })),
        { id: 8229, complex_id: 0, values: [{ dictionary_value_id: typeId }] },
      ];
      setPublishAttributeJson(JSON.stringify(template, null, 2));
    } catch (e) { setPublishError(e instanceof Error ? e.message : "Не удалось загрузить атрибуты Ozon."); }
    finally { setPublishBusy(false); }
  }

  async function selectPublishSubject(value: string) {
    setSelectedWbSubject(value); setPublishAttributes([]); setPublishAttributeJson("[]"); setPublishError("");
    if (!value) return;
    setPublishBusy(true);
    try {
      const result = await getWildberriesSubjectCharacteristics(Number(value));
      setPublishAttributes(result.characteristics);
      const required = result.characteristics.filter((item) => item.required === true || item.is_required === true);
      setPublishAttributeJson(JSON.stringify(required.map((item) => ({ id: Number(item.charcID ?? item.id), value: "" })), null, 2));
    } catch (e) { setPublishError(e instanceof Error ? e.message : "Не удалось загрузить характеристики Wildberries."); }
    finally { setPublishBusy(false); }
  }

  function readPublishAttribute(id: number): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(publishAttributeJson);
      return Array.isArray(parsed) ? (parsed.find((item) => Number((item as Record<string, unknown>)?.id) === id) as Record<string, unknown> | undefined) ?? {} : {};
    } catch { return {}; }
  }

  function updatePublishAttribute(id: number, value: string, dictionary = false) {
    try {
      const parsed: unknown = JSON.parse(publishAttributeJson);
      if (!Array.isArray(parsed)) return;
      const updated = parsed.map((raw) => {
        const item = raw as Record<string, unknown>;
        if (Number(item.id) !== id) return item;
        if (publishTarget?.marketplace === "ozon") {
          return { ...item, values: [{ ...(dictionary ? { dictionary_value_id: Number(value) || 0 } : { value }) }] };
        }
        const attribute = publishAttributes.find((candidate) => Number(candidate.charcID ?? candidate.id) === id);
        const multiValue = Number(attribute?.maxCount ?? 1) > 1;
        const values = multiValue ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : value;
        return { ...item, value: values };
      });
      setPublishAttributeJson(JSON.stringify(updated, null, 2));
    } catch { /* preserve the form state if it was edited outside these controls */ }
  }

  async function searchOzonDictionary(attributeId: number) {
    const term = (ozonDictionarySearch[attributeId] ?? "").trim();
    const categoryType = ozonCategoryTypes.find((item) => `${item.categoryId}:${item.typeId}` === selectedCategoryType);
    if (!categoryType || term.length < 2) return;
    setOzonDictionaryBusy(attributeId); setPublishError("");
    try {
      const result = await searchOzonAttributeValues(categoryType.categoryId, categoryType.typeId, attributeId, term);
      setOzonDictionaryOptions((current) => ({ ...current, [attributeId]: result.values }));
      if (!result.values.length) setPublishError("Для этого значения Ozon не нашёл вариантов в справочнике.");
    } catch (e) { setPublishError(e instanceof Error ? e.message : "Не удалось найти значение в справочнике Ozon."); }
    finally { setOzonDictionaryBusy(null); }
  }

  async function submitPublishProduct() {
    if (!publishTarget) return;
    const { product, marketplace } = publishTarget;
    const categoryType = ozonCategoryTypes.find((item) => `${item.categoryId}:${item.typeId}` === selectedCategoryType);
    const selectedSubject = wbSubjects.find((item) => String(item.subjectID) === selectedWbSubject);
    const categoryId = marketplace === "ozon" ? categoryType?.categoryId : selectedSubject?.subjectID;
    const typeId = marketplace === "ozon" ? categoryType?.typeId : undefined;
    if (!categoryId || (marketplace === "ozon" && !typeId)) { setPublishError("Сначала выберите категорию и тип товара."); return; }
    let attributes: unknown[];
    try {
      const parsed: unknown = JSON.parse(publishAttributeJson);
      if (!Array.isArray(parsed)) throw new Error();
      attributes = parsed;
    } catch { setPublishError("Проверьте JSON атрибутов: требуется корректный массив."); return; }
    setPublishing(marketplace); setPublishBusy(true); setPublishError("");
    try {
      await publishCogsProduct(product.id, marketplace, { categoryId: String(categoryId), ...(typeId ? { typeId: String(typeId) } : {}), attributes });
      await refresh();
      const updated = (await listCogsProducts()).find((item) => item.id === product.id);
      if (updated) setSelected(updated);
      setPublishTarget(null);
      window.alert("Карточка отправлена на площадку. Проверьте статус обработки в кабинете продавца.");
    } catch (e) { setPublishError(e instanceof Error ? e.message : "Не удалось отправить карточку."); }
    finally { setPublishing(null); setPublishBusy(false); }
  }

  async function uploadWildberriesMedia(product: CogsProduct) {
    setPublishing("wildberries"); setError("");
    try {
      const result = await uploadWildberriesProductMedia(product.id);
      await refresh();
      const updated = (await listCogsProducts()).find((item) => item.id === product.id);
      if (updated) setSelected(updated);
      window.alert(`Фотографии переданы Wildberries: ${result.photosUploaded}. Проверка карточки выполняется на площадке.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось передать фотографии в Wildberries."); }
    finally { setPublishing(null); }
  }
  const set = (key: keyof ProductForm, value: string) => setForm(current => ({ ...current, [key]: value }));
  const field = (label: string, key: keyof ProductForm, placeholder = "", type = "text") => (
    <div className="field"><label>{label}</label><input className="input" type={type} value={String(form[key])} placeholder={placeholder} onChange={e => set(key, e.target.value)} /></div>
  );
  return <>
    <div className="page-header">
      <div><h1>Товары</h1><div className="subtitle">Единый каталог товаров, себестоимости и размещения на маркетплейсах</div></div>
    </div>
    <div className="info-banner">Импорт добавляет товары из подключённого кабинета в общий каталог. Себестоимость импортированной карточки равна 0 ₽. Для Wildberries цена также может быть 0 ₽, если у API-ключа нет доступа к ценам.</div>
    {error && <div className="info-banner" role="alert">{error}</div>}
    {creating || selected || editing ? (
      <div className="card">
        <div className="card-head">
          <div><button className="btn btn-outline btn-sm" onClick={() => { setSelected(null); setEditing(null); setCreating(false); setHistoryOpen(false); }}><ArrowLeft size={14}/> К каталогу</button><h2 className="card-title" style={{marginTop:12}}>{editing ? "Редактирование карточки" : selected ? selected.productName : "Новый товар"}</h2></div>
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

          <section>
            <h3>
              <ImagePlus size={16} style={{ verticalAlign: "middle" }} /> Фотографии товара (до 5)
            </h3>

            <div className="field">
              <label>Загрузить фотографии с компьютера</label>
              <input
                className="input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={form.images.filter((url) => url.trim()).length + imageFiles.length >= 5}
                onChange={handleImageFilesChange}
              />
              <p className="card-sub">
                JPG, PNG или WebP. Максимум 10 МБ на фотографию.
              </p>
            </div>

            {imagePreviews.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {imagePreviews.map((url, index) => (
                  <div key={`${url}-${index}`} style={{ position: "relative" }}>
                    <img
                      src={url}
                      alt={`Новая фотография ${index + 1}`}
                      style={{ width: 100, height: 100, objectFit: "cover", borderRadius: 8 }}
                    />
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => setImageFiles((current) => current.filter((_, i) => i !== index))}
                    >
                      Убрать
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid-2-even">
              {form.images.map((url, index) => (
                <div className="field" key={index}>
                  <label>Ссылка на изображение {index + 1}</label>
                  <input
                    className="input"
                    type="url"
                    placeholder="https://..."
                    value={url}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        images: current.images.map((value, i) =>
                          i === index ? e.target.value : value
                        ),
                      }))
                    }
                  />
                  {url.trim() && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => void removeImage(index)}
                    >
                      Удалить фотографию
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>


          <section>
            <h3>
              <Video size={16} style={{ verticalAlign: "middle" }} /> Видеообзор
            </h3>

            <div className="field">
              <label>Загрузить видео с компьютера</label>
              <input
                className="input"
                type="file"
                accept="video/mp4,video/webm"
                onChange={handleVideoFileChange}
              />
              <p className="card-sub">
                Форматы MP4 и WebM. Максимальный размер — 100 МБ.
              </p>
            </div>

            {videoFile && (
              <div className="field">
                <p>Выбранный файл: {videoFile.name}</p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setVideoFile(null)}
                >
                  Убрать выбранное видео
                </button>
              </div>
            )}

            {form.videoUrl && (
              <div className="field">
                <label>Текущее видео</label>
                <video
                  src={form.videoUrl}
                  controls
                  style={{ width: "100%", maxWidth: 480, borderRadius: 8 }}
                />
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void removeVideo()}
                >
                  Удалить видео
                </button>
              </div>
            )}
          </section>

          <section><h3>Описание</h3><div className="field"><label>Полное описание товара</label><textarea className="input" rows={5} value={form.description} onChange={e => set("description",e.target.value)} placeholder="Описание, преимущества, комплектация..."/></div></section>
          <section><h3>Площадки</h3><div style={{display:"flex",gap:18,flexWrap:"wrap"}}>{([ ["ozon", "Ozon"], ["wildberries", "Wildberries"] ] as const).map(([id,label]) => <label key={id} style={{display:"flex",alignItems:"center",gap:8}}><input type="checkbox" checked={form.marketplaces.includes(id)} onChange={(e) => setForm(current => ({...current, marketplaces: e.target.checked ? [...current.marketplaces, id] : current.marketplaces.filter(item => item !== id)}))}/>{label}</label>)}</div><p className="card-sub">Площадки сохраняются отдельными связями. Новые карточки требуют дополнительных атрибутов категории.</p></section>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button className="btn btn-primary" type="submit" disabled={saving}><Save size={15}/>{saving ? "Сохраняем…" : "Сохранить товар"}</button><button className="btn btn-outline" type="button" onClick={() => {setSelected(null);setEditing(null);setCreating(false);}}>Отмена</button></div>
        </form> : (
          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,2fr)",gap:24}}>
            <div>{readImages(selected.images).length ? <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>{readImages(selected.images).map((url,i)=><img key={i} src={url} alt={selected.productName} style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:10}}/> )}</div> : <div className="empty-state"><ImagePlus size={30}/><p>Фотографии пока не добавлены</p></div>}{selected.videoUrl && <a className="link" href={selected.videoUrl} target="_blank" rel="noreferrer"><Video size={14}/> Открыть видеообзор <ExternalLink size={12}/></a>}</div>
            <div><h2>{selected.productName}</h2><p>{selected.characteristics}</p><div className="grid-2-even"><div><span className="card-sub">Артикул</span><b>{selected.sellerSku}</b></div><div><span className="card-sub">Бренд</span><b>{selected.brand || "—"}</b></div><div><span className="card-sub">Страна</span><b>{selected.countryOfOrigin || "—"}</b></div><div><span className="card-sub">Единица</span><b>{selected.unit || "шт."}</b></div><div><span className="card-sub">Цена продажи</span><b>{money(selected.salePrice ?? 0)}</b></div><div><span className="card-sub">Себестоимость</span><b>{money(selected.unitCost)}</b></div></div><h3>Описание</h3><p style={{whiteSpace:"pre-wrap"}}>{selected.description || "Описание не заполнено."}</p><h3>Площадки</h3>{(selected.marketplaces ?? []).map(link => <div key={link.marketplace} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}><span className="badge badge-blue">{link.marketplace === "ozon" ? "Ozon" : "Wildberries"}: {link.publicationStatus}</span><button className="btn btn-outline btn-sm" disabled={Boolean(publishing) || ["submitted", "published"].includes(link.publicationStatus)} onClick={() => void publishProduct(selected, link.marketplace)}>{publishing === link.marketplace ? "Отправляем…" : link.publicationStatus === "published" ? "Уже в кабинете" : link.publicationStatus === "submitted" ? "Отправлено" : "Отправить карточку"}</button>{link.marketplace === "wildberries" && link.publicationStatus === "submitted" && <button className="btn btn-outline btn-sm" disabled={Boolean(publishing)} onClick={() => void uploadWildberriesMedia(selected)}>Передать фото WB</button>}</div>)}{!selected.marketplaces?.length && <span className="badge badge-blue">{selected.marketplace === "both" ? "Ozon + WB" : selected.marketplace === "ozon" ? "Ozon" : "Wildberries"}</span>}<p className="card-sub">Категория и обязательные атрибуты загружаются из API выбранной площадки. Для WB после обработки карточки нажмите «Передать фото WB». Фотографии для площадок должны быть прямыми общедоступными HTTPS-ссылками.</p></div>
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
      <div className="card"><div className="card-head" style={{gap:12,flexWrap:"wrap"}}><h2 className="card-title">Каталог товаров</h2><div style={{display:"flex",gap:8,flexWrap:"wrap",marginLeft:"auto"}}><button className="btn btn-outline btn-sm" onClick={() => void importProducts("ozon")} disabled={Boolean(importing)}><Download size={15}/>{importing === "ozon" ? "Импортируем…" : "Импорт Ozon"}</button><button className="btn btn-outline btn-sm" onClick={() => void importProducts("wildberries")} disabled={Boolean(importing)}><Download size={15}/>{importing === "wildberries" ? "Импортируем…" : "Импорт Wildberries"}</button><button className="btn btn-primary btn-sm" onClick={startNew}><Plus size={16}/> Добавить товар</button></div></div>
        {loading ? <div className="empty-state">Загружаем каталог…</div> : !visible.length ? <div className="empty-state"><PackagePlus size={32}/><p>Товаров пока нет. Добавьте первую карточку.</p><button className="btn btn-primary" onClick={startNew}>Добавить товар</button></div> :
        <div style={{overflowX:"auto"}}><table className="table"><thead><tr><th>Товар</th><th>Артикул</th><th>Площадки</th><th>Цена</th><th>Себестоимость</th><th>Статус</th><th></th></tr></thead><tbody>{visible.map(product=><tr key={product.id}>
          <td><button className="link" style={{border:0,background:"none",cursor:"pointer",textAlign:"left"}} onClick={()=>{setSelected(product);setHistoryOpen(false);}}>{product.productName}</button></td><td>{product.sellerSku}</td><td>{(product.marketplaces ?? []).map(item => item.marketplace === "ozon" ? "Ozon" : "WB").join(" + ") || (product.marketplace === "both" ? "Ozon + WB" : product.marketplace === "ozon" ? "Ozon" : "Wildberries")}</td><td>{money(product.salePrice ?? 0)}</td><td><b>{money(product.unitCost)}</b></td><td><span className="badge badge-gray">{product.marketplaces?.some(item => item.publicationStatus === "submitted") ? "Отправлен" : product.marketplaces?.some(item => item.publicationStatus === "published") ? "В каталоге" : "Черновик"}</span></td><td><button className="btn btn-outline btn-sm" title="Редактировать" onClick={()=>startEdit(product)}><Pencil size={14}/></button></td>
        </tr>)}</tbody></table></div>}
      </div>
    </>}
    {publishTarget && <div className="publish-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !publishBusy) setPublishTarget(null); }}>
      <section className="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-dialog-title">
        <header><div><h2 id="publish-dialog-title">Публикация на {publishTarget.marketplace === "ozon" ? "Ozon" : "Wildberries"}</h2><p>{publishTarget.product.productName}</p></div><button className="btn btn-outline btn-sm" disabled={publishBusy} onClick={() => setPublishTarget(null)}>Закрыть</button></header>
        {publishTarget.marketplace === "ozon" ? <>
          <div className="field"><label htmlFor="publish-category-search">Поиск категории или типа</label><input id="publish-category-search" className="input" value={publishSearch} onChange={(event) => setPublishSearch(event.target.value)} placeholder="Например, коврики для ванной" /></div>
          <div className="field"><label htmlFor="publish-ozon-category">Категория и тип Ozon</label><select id="publish-ozon-category" className="input" size={6} value={selectedCategoryType} onChange={(event) => void selectPublishCategory(event.target.value)} disabled={publishBusy}>
            {ozonCategoryTypes.filter((item) => !publishSearch.trim() || item.path.toLocaleLowerCase("ru").includes(publishSearch.trim().toLocaleLowerCase("ru"))).slice(0, 250).map((item) => <option key={`${item.categoryId}:${item.typeId}`} value={`${item.categoryId}:${item.typeId}`}>{item.path} · {item.categoryId}/{item.typeId}</option>)}
          </select><small className="card-sub">Категорий загружено: {ozonCategoryTypes.length}. Уточните поиск, чтобы сократить список.</small></div>
        </> : <>
          <div className="field"><label htmlFor="publish-subject-search">Поиск предмета WB</label><div className="publish-search-row"><input id="publish-subject-search" className="input" value={publishSearch} onChange={(event) => setPublishSearch(event.target.value)} placeholder="Введите название предмета" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchPublishSubjects(); } }} /><button className="btn btn-outline" onClick={() => void searchPublishSubjects()} disabled={publishBusy || publishSearch.trim().length < 2}>Найти</button></div></div>
          <div className="field"><label htmlFor="publish-wb-subject">Предмет Wildberries</label><select id="publish-wb-subject" className="input" value={selectedWbSubject} onChange={(event) => void selectPublishSubject(event.target.value)} disabled={publishBusy || !wbSubjects.length}><option value="">Выберите предмет</option>{wbSubjects.map((item) => <option key={item.subjectID} value={String(item.subjectID)}>{item.subjectName}{item.parentName ? ` · ${item.parentName}` : ""} · {item.subjectID}</option>)}</select></div>
        </>}
        {publishAttributes.length > 0 && <div className="publish-attributes-info">Заполните обязательные характеристики ({publishAttributes.filter((item) => (item.is_required === true || item.required === true) && !(publishTarget?.marketplace === "ozon" && Number(item.id) === 8229)).length}). Для значений из справочника Ozon воспользуйтесь поиском.</div>}
        {publishAttributes.filter((item) => (item.is_required === true || item.required === true) && !(publishTarget?.marketplace === "ozon" && Number(item.id) === 8229)).map((attribute) => {
          const id = Number(attribute.charcID ?? attribute.id);
          const current = readPublishAttribute(id);
          const values = Array.isArray(current.values) ? current.values : [];
          const firstValue = values.length ? values[0] as Record<string, unknown> : {};
          const rawValue = publishTarget.marketplace === "ozon"
            ? (Number(attribute.dictionary_id) > 0 ? String(firstValue.dictionary_value_id ?? "") : String(firstValue.value ?? ""))
            : Array.isArray(current.value) ? (current.value as unknown[]).join(", ") : String(current.value ?? "");
          const dictionary = publishTarget.marketplace === "ozon" && Number(attribute.dictionary_id) > 0;
          return <div className="field" key={id}>
            <label htmlFor={`publish-attribute-${id}`}>{attribute.name || `Характеристика ${id}`}{attribute.unit_name ? `, ${attribute.unit_name}` : ""}</label>
            {dictionary ? <>
              <div className="publish-search-row"><input id={`publish-attribute-${id}`} className="input" value={ozonDictionarySearch[id] ?? ""} onChange={(event) => setOzonDictionarySearch((currentSearch) => ({ ...currentSearch, [id]: event.target.value }))} placeholder="Введите значение для поиска" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchOzonDictionary(id); } }} /><button className="btn btn-outline" type="button" disabled={ozonDictionaryBusy === id || (ozonDictionarySearch[id] ?? "").trim().length < 2} onClick={() => void searchOzonDictionary(id)}>{ozonDictionaryBusy === id ? "Ищем…" : "Найти"}</button></div>
              <select className="input" style={{marginTop:8}} value={rawValue} onChange={(event) => updatePublishAttribute(id, event.target.value, true)}><option value="">Выберите значение справочника</option>{(ozonDictionaryOptions[id] ?? []).map((option) => <option key={option.id} value={option.id}>{option.value}</option>)}</select>
            </> : <input id={`publish-attribute-${id}`} className="input" value={rawValue} onChange={(event) => updatePublishAttribute(id, event.target.value)} placeholder="Введите значение" />}
          </div>;
        })}
        {publishAttributes.length > 0 && <details className="publish-advanced-json"><summary>Показать JSON атрибутов</summary><textarea id="publish-attributes-json" className="input publish-json" spellCheck={false} value={publishAttributeJson} onChange={(event) => setPublishAttributeJson(event.target.value)} rows={8} /></details>}
        <p className="card-sub">Публикация отправляет карточку на площадку. Фотографии должны быть общедоступны по HTTPS. Сам факт отправки не означает, что карточка прошла проверку площадки.</p>
        {publishError && <div className="info-banner" role="alert" style={{ color: "#9b2c2c", background: "#fff5f5", borderColor: "#f2caca" }}>{publishError}</div>}
        <footer><button className="btn btn-outline" disabled={publishBusy} onClick={() => setPublishTarget(null)}>Отмена</button><button className="btn btn-primary" disabled={publishBusy || !publishAttributes.length} onClick={() => void submitPublishProduct()}>{publishBusy ? "Подождите…" : "Отправить карточку"}</button></footer>
      </section>
    </div>}
  </>;
}
