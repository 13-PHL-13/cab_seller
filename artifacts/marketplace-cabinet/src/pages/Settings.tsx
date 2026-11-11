import { useState } from 'react';
import { ExternalLink, Eye, EyeOff, Info, KeyRound, RefreshCw, ShieldCheck, User, Bell, X, Check } from 'lucide-react';
import { API_PLATFORMS, loadSettings, saveSettings } from '@/data/settings';
import type { AppSettings } from '@/data/settings';
import { timeAgo } from '@/lib/format';

type Tab = 'api' | 'profile' | 'notifications';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('api');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});

  const update = (next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  };

  const setCredential = (pid: string, key: string, value: string) => {
    const conn = settings.connections[pid];
    update({
      ...settings,
      connections: {
        ...settings.connections,
        [pid]: { ...conn, credentials: { ...conn.credentials, [key]: value } },
      },
    });
  };

  const connect = (pid: string) => {
    const conn = settings.connections[pid];
    update({
      ...settings,
      connections: {
        ...settings.connections,
        [pid]: { ...conn, connected: true, syncedAt: Date.now() },
      },
    });
  };

  const disconnect = (pid: string) => {
    const conn = settings.connections[pid];
    update({
      ...settings,
      connections: {
        ...settings.connections,
        [pid]: { ...conn, connected: false, syncedAt: null },
      },
    });
  };

  const syncNow = (pid: string) => {
    const conn = settings.connections[pid];
    update({
      ...settings,
      connections: {
        ...settings.connections,
        [pid]: { ...conn, syncedAt: Date.now() },
      },
    });
  };

  const toggleNotification = (key: keyof AppSettings['notifications']) => {
    update({
      ...settings,
      notifications: { ...settings.notifications, [key]: !settings.notifications[key] },
    });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Настройки</h1>
          <div className="subtitle">Управление подключениями и профилем</div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'api' ? 'active' : ''} onClick={() => setTab('api')}>
          <KeyRound size={15} />
          API Подключения
        </button>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
          <User size={15} />
          Профиль
        </button>
        <button className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}>
          <Bell size={15} />
          Уведомления
        </button>
      </div>

      {tab === 'api' && (
        <div>
          <div className="info-banner">
            <Info size={17} />
            <div>
              <strong>Как подключить API</strong>
              <br />
              Получите API-ключ в личном кабинете маркетплейса и введите его здесь. После подключения данные будут автоматически синхронизироваться.
            </div>
          </div>

          {API_PLATFORMS.map((p) => {
            const conn = settings.connections[p.id];
            return (
              <div className={`conn-card${conn.connected ? ' connected' : ''}`} key={p.id} style={{ marginBottom: 14 }}>
                <div className="conn-head">
                  <div className="conn-title">
                    <span className="chip" style={{ background: p.color }}>{p.initial}</span>
                    <div>
                      <h3>{p.name}</h3>
                      <p>{p.description}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
                    {conn.connected ? (
                      <>
                        <span className="badge badge-green" style={{ gap: 6 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--green)', display: 'inline-block' }} />
                          Синхронизация: {conn.syncedAt ? timeAgo(Math.floor((Date.now() - conn.syncedAt) / 1000)) : '…'}
                        </span>
                        <button className="btn btn-danger btn-sm" onClick={() => disconnect(p.id)}>
                          <X size={13} />
                          Отключить
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => connect(p.id)}
                        disabled={!p.fields.every((f) => (conn.credentials[f.key] ?? '').trim())}
                      >
                        <Check size={13} />
                        Подключить
                      </button>
                    )}
                  </div>
                </div>

                <div className="conn-fields">
                  {p.fields.map((f) => (
                    <div className="field" key={f.key}>
                      <label>{f.label}</label>
                      <div style={{ position: 'relative' }}>
                        <input
                          className="input"
                          style={{ paddingRight: 38 }}
                          type={showSecret[`${p.id}-${f.key}`] ? 'text' : 'password'}
                          placeholder={f.placeholder}
                          value={conn.credentials[f.key] ?? ''}
                          onChange={(e) => setCredential(p.id, f.key, e.target.value)}
                        />
                        <button
                          type="button"
                          aria-label="Показать или скрыть"
                          onClick={() => setShowSecret((s) => ({ ...s, [`${p.id}-${f.key}`]: !s[`${p.id}-${f.key}`] }))}
                          style={{ position: 'absolute', right: 10, top: 8, background: 'none', border: 0, cursor: 'pointer', color: 'var(--muted)', padding: 2, display: 'flex' }}
                        >
                          {showSecret[`${p.id}-${f.key}`] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="conn-actions">
                  <a className="link" href={p.docsUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ExternalLink size={13} />
                    Документация API
                  </a>
                  {conn.connected ? (
                    <button className="link" style={{ background: 'none', border: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => syncNow(p.id)}>
                      <RefreshCw size={13} />
                      Синхронизировать сейчас
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}

          <div className="info-banner" style={{ background: '#f2f5f7', borderColor: 'var(--border)', color: '#45535f' }}>
            <ShieldCheck size={17} />
            <div>
              <strong>Защита данных</strong>
              <br />
              Ключи хранятся только локально в этом демо-режиме. В рабочей версии секретные ключи передаются на сервер по защищённому каналу и не сохраняются в браузере. Используйте ключи с минимально необходимыми правами.
            </div>
          </div>

        </div>
      )}

      {tab === 'profile' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-head">
            <div>
              <h2 className="card-title">Профиль продавца</h2>
              <div className="card-sub">Данные организации для отчётов</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div className="field">
              <label>Имя / ФИО</label>
              <input className="input" value={settings.profile.name} onChange={(e) => update({ ...settings, profile: { ...settings.profile, name: e.target.value } })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={settings.profile.email} onChange={(e) => update({ ...settings, profile: { ...settings.profile, email: e.target.value } })} />
            </div>
            <div className="field">
              <label>Организация</label>
              <input className="input" value={settings.profile.company} onChange={(e) => update({ ...settings, profile: { ...settings.profile, company: e.target.value } })} />
            </div>
            <div className="field">
              <label>ИНН</label>
              <input className="input" value={settings.profile.inn} onChange={(e) => update({ ...settings, profile: { ...settings.profile, inn: e.target.value } })} />
            </div>
            <div>
              <button className="btn btn-primary" onClick={() => saveSettings(settings)}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-head">
            <div>
              <h2 className="card-title">Уведомления</h2>
              <div className="card-sub">Что присылать в кабинет и на почту</div>
            </div>
          </div>
          <div className="notif-row">
            <div>
              <div className="t">Ежедневный отчёт о продажах</div>
              <div className="d">Сводка по выручке и заказам за вчера</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={settings.notifications.dailyReport} onChange={() => toggleNotification('dailyReport')} />
              <span className="track" />
            </label>
          </div>
          <div className="notif-row">
            <div>
              <div className="t">Низкие остатки</div>
              <div className="d">Предупреждение, когда осталось меньше 10 шт</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={settings.notifications.lowStock} onChange={() => toggleNotification('lowStock')} />
              <span className="track" />
            </label>
          </div>
          <div className="notif-row">
            <div>
              <div className="t">Новые отзывы</div>
              <div className="d">Уведомлять об отзывах и вопросах покупателей</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={settings.notifications.newReviews} onChange={() => toggleNotification('newReviews')} />
              <span className="track" />
            </label>
          </div>
          <div className="notif-row">
            <div>
              <div className="t">Выплаты</div>
              <div className="d">Статусы выплат и изменение баланса</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={settings.notifications.payouts} onChange={() => toggleNotification('payouts')} />
              <span className="track" />
            </label>
          </div>
          <div className="notif-row">
            <div>
              <div className="t">Изменение цен конкурентов</div>
              <div className="d">Когда цена на ваш товар меняется на площадке</div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={settings.notifications.priceChanges} onChange={() => toggleNotification('priceChanges')} />
              <span className="track" />
            </label>
          </div>
        </div>
      )}
    </>
  );
}
