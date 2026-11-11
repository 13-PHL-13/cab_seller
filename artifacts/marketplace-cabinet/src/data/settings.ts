/**
 * Настройки пользователя: API-подключения, профиль, уведомления.
 * Хранятся в localStorage. При появлении бэкенда — миграция на API.
 */

export interface Connection {
  connected: boolean;
  credentials: Record<string, string>;
  syncedAt: number | null; // ms последней синхронизации
}

export interface ApiField {
  key: string;
  label: string;
  placeholder: string;
}

export interface ApiPlatformMeta {
  id: string;
  name: string;
  color: string;
  initial: string;
  description: string;
  docsUrl: string;
  fields: ApiField[];
}

export const API_PLATFORMS: ApiPlatformMeta[] = [
  {
    id: 'ozon',
    name: 'Ozon Seller API',
    color: '#005BFF',
    initial: 'O',
    description: 'Подключите Ozon Seller API для получения данных о заказах, товарах и аналитике',
    docsUrl: 'https://docs.ozon.ru/api/seller/',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Введите Client ID' },
      { key: 'apiKey', label: 'API Key / Token', placeholder: 'Введите API ключ' },
    ],
  },
  {
    id: 'wb',
    name: 'Wildberries API',
    color: '#A73AFD',
    initial: 'W',
    description: 'Подключите WB API для управления товарами, заказами и статистикой продаж',
    docsUrl: 'https://dev.wildberries.ru/',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Введите Client ID' },
      { key: 'apiKey', label: 'API Key / Token', placeholder: 'Введите API ключ' },
    ],
  },
  {
    id: 'yandex',
    name: 'Яндекс Маркет',
    color: '#FC3F1D',
    initial: 'Я',
    description: 'Подключите API Яндекс Маркета для синхронизации данных о продажах',
    docsUrl: 'https://yandex.ru/dev/market/partner-api/',
    fields: [
      { key: 'campaignId', label: 'Campaign ID', placeholder: 'Введите Campaign ID' },
      { key: 'apiKey', label: 'OAuth Token', placeholder: 'Введите OAuth токен' },
    ],
  },
  {
    id: 'megamarket',
    name: 'Мегамаркет (Сбер)',
    color: '#00843D',
    initial: 'M',
    description: 'Подключите Мегамаркет API для управления ассортиментом и заказами',
    docsUrl: 'https://dev.megamarket.ru/',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Введите Client ID' },
      { key: 'token', label: 'Token', placeholder: 'Введите токен' },
    ],
  },
];

export interface Profile {
  name: string;
  email: string;
  company: string;
  inn: string;
}

export interface Notifications {
  dailyReport: boolean;
  lowStock: boolean;
  newReviews: boolean;
  payouts: boolean;
  priceChanges: boolean;
}

export interface AppSettings {
  connections: Record<string, Connection>;
  profile: Profile;
  notifications: Notifications;
}

const STORAGE_KEY = 'navigator-sales-settings';

const DEFAULT_SETTINGS: AppSettings = {
  connections: Object.fromEntries(
    API_PLATFORMS.map((p) => [p.id, { connected: false, credentials: {}, syncedAt: null } as Connection]),
  ),
  profile: {
    name: 'ИП Клеедин А. Ю.',
    email: 'seller@navigator.ru',
    company: 'ИП Клеедин А. Ю.',
    inn: '7712345678',
  },
  notifications: {
    dailyReport: true,
    lowStock: true,
    newReviews: true,
    payouts: true,
    priceChanges: false,
  },
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      connections: { ...DEFAULT_SETTINGS.connections, ...(parsed.connections ?? {}) },
      profile: { ...DEFAULT_SETTINGS.profile, ...(parsed.profile ?? {}) },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
