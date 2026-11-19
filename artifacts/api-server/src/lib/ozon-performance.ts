export interface PerformanceCredentials { clientId: string; clientSecret: string }
export interface OzonStoreCredentials { clientId: string; apiKey: string; performance?: PerformanceCredentials }

export function parsePerformanceCredentials(value: unknown): PerformanceCredentials | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.clientId !== 'string' || typeof input.clientSecret !== 'string') return null;
  const clientId = input.clientId.trim(), clientSecret = input.clientSecret.trim();
  return clientId && clientSecret && clientId.length <= 2000 && clientSecret.length <= 4000 ? { clientId, clientSecret } : null;
}

// Only presence is returned to the browser, never either identifier or secret.
export function performanceConfigured(credentials: OzonStoreCredentials): boolean {
  return Boolean(parsePerformanceCredentials(credentials.performance));
}

export async function verifyPerformanceCredentials(credentials: PerformanceCredentials, request: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try {
    response = await request('https://api-performance.ozon.ru/api/client/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: credentials.clientId, client_secret: credentials.clientSecret, grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
  } catch { throw new Error('Performance API Ozon не ответил. Повторите подключение позже.'); }
  if (!response.ok) {
    // Provider bodies can echo submitted credentials. Do not return or log them.
    if (response.status === 429) throw new Error('Ozon ограничил частоту запросов Performance API. Повторите позже.');
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new Error('Performance API отклонил ключи. Проверьте отдельные Client ID и Client Secret.');
    throw new Error('Не удалось проверить Performance API Ozon. Повторите позже.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || !('access_token' in payload) || typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
    throw new Error('Performance API не подтвердил доступ. Проверьте ключи и повторите подключение.');
  }
  // The short-lived bearer token is deliberately discarded, not persisted.
}
