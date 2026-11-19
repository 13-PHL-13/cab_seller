import { useEffect, useId, useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff, Plus, ShieldCheck, X } from 'lucide-react';
import { connectMarketplace, deleteMarketplaceStore, formatApiError, getMarketplaceStores, updateOzonPerformance, type MarketplaceStore } from '@/lib/marketplace-api';
import ApiGuide from './ApiGuide';
import './api-connections.css';

type Platform = 'wb' | 'ozon';
type Draft = { storeName: string; clientId: string; apiKey: string; performanceId: string; clientSecret: string };
const empty: Draft = { storeName: '', clientId: '', apiKey: '', performanceId: '', clientSecret: '' };

function SecretField({ label, value, onChange, maxLength = 4000 }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number }) {
  const id = useId(), [visible, setVisible] = useState(false);
  return <div className="field"><label htmlFor={id}>{label}</label><div className="connection-secret">
    <input id={id} className="input" type={visible ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} required maxLength={maxLength} autoComplete="new-password" spellCheck={false} />
    <button type="button" aria-label={`${visible ? 'Скрыть' : 'Показать'} ${label}`} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
  </div></div>;
}

function ConnectForm({ platform, store, existingNames, onSaved, onCancel }: { platform: Platform; store?: MarketplaceStore; existingNames: string[]; onSaved: () => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>({ ...empty }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const id = useId();
  const set = (key: keyof Draft) => (value: string) => setDraft(current => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const name = draft.storeName.trim();
    if (!store && (!name || existingNames.includes(name))) { setError(name ? 'Магазин с таким названием уже добавлен. Используйте другое название для нового магазина.' : 'Укажите название магазина.'); return; }
    setBusy(true);
    try {
      const performance = { clientId: draft.performanceId.trim(), clientSecret: draft.clientSecret.trim() };
      if (store) await updateOzonPerformance(store.id, performance);
      else await connectMarketplace(platform === 'wb' ? 'wildberries' : 'ozon', platform === 'wb'
        ? { apiKey: draft.apiKey.trim(), storeName: name }
        : { clientId: draft.clientId.trim(), apiKey: draft.apiKey.trim(), storeName: name, performance });
      setDraft({ ...empty }); await onSaved();
    } catch (err) { setError(formatApiError(err)); } finally { setBusy(false); }
  }
  return <form className="connection-form" onSubmit={submit} aria-label={store ? `Performance API: ${store.storeName}` : `Новый магазин ${platform === 'wb' ? 'Wildberries' : 'Ozon'}`}>
    <fieldset disabled={busy}>
      <legend>{store ? `Performance API · ${store.storeName}` : 'Подключить новый магазин'}</legend>
      {!store && <div className="field"><label htmlFor={id}>Название магазина</label><input id={id} className="input" value={draft.storeName} onChange={e => set('storeName')(e.target.value)} required maxLength={120} placeholder="Например, Основной магазин" /></div>}
      {!store && (platform === 'ozon' ? <section className="connection-key-block"><h4>1. Seller API <small>Обязательно</small></h4><p>Ключи магазина из раздела Seller API.</p><div className="connection-fields"><SecretField label="Client ID · Seller API" value={draft.clientId} onChange={set('clientId')} /><SecretField label="API Key · Seller API" value={draft.apiKey} onChange={set('apiKey')} /></div></section> : <SecretField label="API-токен" value={draft.apiKey} onChange={set('apiKey')} />)}
      {platform === 'ozon' && <section className="connection-key-block"><h4>{store ? '' : '2. '}Performance API <small>Обязательно</small></h4><p>Отдельные ключи этого же магазина. Нужны для функций рекламы и продвижения.</p><div className="connection-fields"><SecretField label="Client ID · Performance API" value={draft.performanceId} onChange={set('performanceId')} maxLength={2000} /><SecretField label="Client Secret · Performance API" value={draft.clientSecret} onChange={set('clientSecret')} /></div></section>}
      {error && <p role="alert" className="connection-error">{error}</p>}
      <div className="connection-buttons"><button className="btn btn-primary" disabled={busy}>{busy ? 'Проверяем доступ…' : store ? 'Проверить и сохранить Performance API' : 'Проверить и подключить магазин'}</button><button className="btn" type="button" onClick={onCancel}>Отмена</button></div>
    </fieldset>
  </form>;
}

export default function ApiConnections() {
  const [stores, setStores] = useState<MarketplaceStore[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [adding, setAdding] = useState<Platform | null>(null), [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function refresh() { const result = await getMarketplaceStores(); setStores(result.stores); window.dispatchEvent(new Event('marketplace-stores-updated')); }
  useEffect(() => { let current = true; void getMarketplaceStores().then(result => { if (current) setStores(result.stores); }).catch(err => { if (current) setError(formatApiError(err)); }).finally(() => { if (current) setLoading(false); }); return () => { current = false; }; }, []);
  async function saved() { await refresh(); setAdding(null); setEditing(null); setMessage('Доступ проверен, ключи сохранены на сервере.'); }
  async function remove(id: number) {
    setBusy(true); setError('');
    try { await deleteMarketplaceStore(id); await refresh(); setDeleting(null); setMessage('Магазин отключён.'); }
    catch (err) { setError(formatApiError(err)); } finally { setBusy(false); }
  }
  return <div className="api-connections">
    <div className="info-banner"><ShieldCheck size={20} /><div><strong>Несколько магазинов — одна компания</strong><p>Добавляйте каждый магазин отдельно со своими ключами. Уже добавленные магазины перечислены ниже — повторно подключать их не нужно.</p></div></div>
    {error && <p className="connection-error" role="alert">{error}</p>}{message && <p className="connection-success" role="status">{message}</p>}
    {loading ? <p role="status">Загружаем магазины…</p> : (['wb', 'ozon'] as const).map(platform => {
      const own = stores.filter(store => store.marketplace === (platform === 'wb' ? 'wildberries' : 'ozon'));
      return <section className="conn-card connection-platform" key={platform} aria-label={platform === 'wb' ? 'Wildberries' : 'Ozon'}>
        <header className="connection-heading"><div className="conn-title"><span className={`connection-logo ${platform}`}>{platform === 'wb' ? 'WB' : 'Ozon'}</span><div><h2>{platform === 'wb' ? 'Wildberries' : 'Ozon'}</h2><p>{platform === 'wb' ? 'Один API-токен на магазин' : 'Seller API и Performance API для одного магазина'}</p></div></div><button className="btn btn-primary" onClick={() => { setAdding(platform); setEditing(null); setMessage(''); }}><Plus size={16} />{own.length ? 'Добавить ещё магазин' : 'Добавить магазин'}</button></header>
        {own.length > 0 && <div className="connection-stores"><h3>Уже добавленные магазины <span>{own.length}</span></h3>{own.map(store => <article className="connection-store" key={store.id}>
          <div className="connection-store-heading"><div><strong>{store.storeName}</strong><p>Повторно добавлять не нужно</p></div><span className="badge badge-green"><Check size={14} /> Уже добавлен</span></div>
          {platform === 'ozon' && <p>{store.performanceConnected ? 'Seller API и Performance API: ключи сохранены.' : 'Seller API подключён. Добавьте Performance API для функций рекламы.'}</p>}
          <div className="connection-buttons">{platform === 'ozon' && <button className="btn btn-outline" onClick={() => { setEditing(store.id); setAdding(null); }}>{store.performanceConnected ? 'Обновить Performance API' : 'Добавить Performance API'}</button>}<button className="link connection-disconnect" onClick={() => setDeleting(store.id)}>Отключить магазин</button></div>
          {editing === store.id && <ConnectForm key={store.id} platform="ozon" store={store} existingNames={[]} onSaved={saved} onCancel={() => setEditing(null)} />}
          {deleting === store.id && <div role="alert" className="connection-confirm"><p>Отключить магазин «{store.storeName}»? Он перестанет предоставлять данные в кабинет.</p><button className="btn btn-danger" disabled={busy} onClick={() => void remove(store.id)}>Да, отключить</button> <button className="btn" disabled={busy} onClick={() => setDeleting(null)}>Отмена</button></div>}
        </article>)}</div>}
        {adding === platform && <ConnectForm platform={platform} key={platform} existingNames={own.map(store => store.storeName)} onSaved={saved} onCancel={() => setAdding(null)} />}
        <ApiGuide platform={platform} />
      </section>;
    })}
    <p className="connection-privacy"><ShieldCheck size={16} /> Ключи проверяются и хранятся на сервере в зашифрованном виде. Они не сохраняются в настройках браузера и не возвращаются в список магазинов.</p>
  </div>;
}
