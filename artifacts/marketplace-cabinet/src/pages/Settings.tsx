import { useEffect, useState } from 'react';
import { Eye, EyeOff, Info, KeyRound, User, Bell, X, Bot, Search, Download } from 'lucide-react';
import { loadSettings, saveSettings } from '@/data/settings';
import type { AppSettings } from '@/data/settings';
import ApiConnections from '@/components/ApiConnections';
import { formatApiError, getAiAssistantConfig, fetchAiModels, saveAiAssistantConfig, disconnectAiAssistant } from '@/lib/marketplace-api';

type Tab = 'api' | 'ai' | 'profile' | 'notifications';

const AI_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'custom', name: 'Другой OpenAI-совместимый провайдер', baseUrl: '' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('api');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [aiConfig, setAiConfig] = useState({ baseUrl: '', apiKey: '', model: '', configured: false, apiKeyConfigured: false });
  const [aiProvider, setAiProvider] = useState('custom');
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [aiSearch, setAiSearch] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  const [aiError, setAiError] = useState('');
  const [showAiKey, setShowAiKey] = useState(false);

  useEffect(() => {
    void getAiAssistantConfig().then((config) => {
      const provider = AI_PROVIDERS.find((item) => item.baseUrl && config.baseUrl.startsWith(item.baseUrl));
      setAiProvider(provider?.id ?? 'custom');
      setAiConfig((current) => ({ ...current, ...config }));
    }).catch((error) => setAiError(formatApiError(error)));
  }, []);

  const loadAiModels = async () => {
    setAiBusy(true); setAiError(''); setAiMessage('');
    try {
      const result = await fetchAiModels(aiConfig.baseUrl, aiConfig.apiKey);
      setAiModels(result.models);
      setAiMessage(`Загружено моделей: ${result.models.length}`);
    } catch (error) { setAiError(formatApiError(error)); }
    finally { setAiBusy(false); }
  };

  const saveAiConfig = async () => {
    setAiBusy(true); setAiError(''); setAiMessage('');
    try {
      const result = await saveAiAssistantConfig({ baseUrl: aiConfig.baseUrl, apiKey: aiConfig.apiKey, model: aiConfig.model });
      setAiConfig((current) => ({ ...current, ...result, apiKey: '' }));
      setAiMessage('Подключение ИИ-провайдера сохранено.');
    } catch (error) { setAiError(formatApiError(error)); }
    finally { setAiBusy(false); }
  };

  const removeAiConfig = async () => {
    setAiBusy(true); setAiError(''); setAiMessage('');
    try {
      await disconnectAiAssistant();
      setAiConfig({ baseUrl: '', apiKey: '', model: '', configured: false, apiKeyConfigured: false });
      setAiModels([]); setAiMessage('Подключение удалено.');
    } catch (error) { setAiError(formatApiError(error)); }
    finally { setAiBusy(false); }
  };

  const filteredAiModels = aiModels.filter((model) => model.toLowerCase().includes(aiSearch.trim().toLowerCase()));

  const update = (next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
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
          <h1>Подключения API</h1>
          <div className="subtitle">Управление подключениями и профилем</div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'api' ? 'active' : ''} onClick={() => setTab('api')}>
          <KeyRound size={15} />
          API Подключения
        </button>
        <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}>
          <Bot size={15} /> ИИ-помощник
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

      {tab === 'api' && <ApiConnections />}

      {tab === 'ai' && (
        <section className="card ai-settings-card">
          <div className="card-head">
            <div><h2 className="card-title">Подключение ИИ-помощника</h2><div className="card-sub">Выберите провайдера и модель для чата на дашборде</div></div>
            <span className={`badge ${aiConfig.configured ? 'badge-green' : ''}`}>{aiConfig.configured ? 'Подключено' : 'Не подключено'}</span>
          </div>
          <div className="info-banner"><Info size={17} /><div>Поддерживаются провайдеры с OpenAI-совместимым API и endpoint списка моделей <code>/models</code>. API-ключ хранится на сервере в зашифрованном виде.</div></div>
          <div className="field">
            <label htmlFor="ai-provider">Провайдер</label>
            <select id="ai-provider" className="input" value={aiProvider} onChange={(event) => {
              const selected = AI_PROVIDERS.find((provider) => provider.id === event.target.value)!;
              setAiProvider(selected.id);
              if (selected.baseUrl) setAiConfig((current) => ({ ...current, baseUrl: selected.baseUrl, model: '' }));
            }}>
              {AI_PROVIDERS.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ai-base-url">Base URL</label>
            <input id="ai-base-url" className="input" type="url" placeholder="https://api.example.com/v1" value={aiConfig.baseUrl} onChange={(event) => setAiConfig((current) => ({ ...current, baseUrl: event.target.value, model: '' }))} />
          </div>
          <div className="field">
            <label htmlFor="ai-api-key">API-ключ {aiConfig.apiKeyConfigured && <span className="ai-key-saved">(ключ сохранён; оставьте пустым, чтобы не менять)</span>}</label>
            <div className="ai-key-input"><input id="ai-api-key" className="input" type={showAiKey ? 'text' : 'password'} autoComplete="new-password" placeholder={aiConfig.apiKeyConfigured ? '••••••••••••••••' : 'Введите API-ключ'} value={aiConfig.apiKey} onChange={(event) => setAiConfig((current) => ({ ...current, apiKey: event.target.value }))} /><button type="button" aria-label={showAiKey ? 'Скрыть API-ключ' : 'Показать API-ключ'} onClick={() => setShowAiKey((visible) => !visible)}>{showAiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
          </div>
          <div className="ai-model-picker">
            <div className="field ai-model-search"><label htmlFor="ai-model-search">Модель</label><div><Search size={16} /><input id="ai-model-search" type="search" placeholder={aiModels.length ? 'Поиск в списке моделей…' : 'Сначала загрузите модели'} value={aiSearch} onChange={(event) => setAiSearch(event.target.value)} disabled={!aiModels.length} /></div></div>
            {aiModels.length > 0 && <div className="ai-model-list" role="listbox" aria-label="Модели провайдера">{filteredAiModels.length ? filteredAiModels.map((model) => <button type="button" role="option" aria-selected={aiConfig.model === model} className={aiConfig.model === model ? 'selected' : ''} key={model} onClick={() => setAiConfig((current) => ({ ...current, model }))}>{model}</button>) : <span>Совпадений нет</span>}</div>}
            {aiConfig.model && <div className="ai-selected-model">Выбрано: <strong>{aiConfig.model}</strong></div>}
          </div>
          {aiError && <div className="info-banner" role="alert" style={{ color: '#9b2c2c', borderColor: '#f2caca', background: '#fff5f5' }}>{aiError}</div>}
          {aiMessage && <div className="info-banner" role="status" style={{ color: '#176b58' }}>{aiMessage}</div>}
          <div className="ai-settings-actions">
            <button className="btn" onClick={() => void loadAiModels()} disabled={aiBusy || !aiConfig.baseUrl.trim()}><Download size={14} />{aiBusy ? 'Загрузка…' : 'Загрузить модели'}</button>
            <div><button className="btn btn-primary" onClick={() => void saveAiConfig()} disabled={aiBusy || !aiConfig.baseUrl.trim() || !aiConfig.model.trim() || (!aiConfig.apiKey.trim() && !aiConfig.apiKeyConfigured)}>{aiBusy ? 'Сохранение…' : 'Сохранить подключение'}</button>{aiConfig.configured && <button className="btn btn-danger btn-sm" onClick={() => void removeAiConfig()} disabled={aiBusy}><X size={13} />Отключить</button>}</div>
          </div>
        </section>
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
