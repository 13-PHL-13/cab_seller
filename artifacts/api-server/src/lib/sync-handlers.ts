import { decryptCredentials } from './marketplace-credentials';
import { getOzonSnapshot, getWildberriesSnapshot } from './marketplace-data';
import { getOzonFinanceReport } from './marketplace-finance-ozon';
import { getWildberriesFinanceReport } from './marketplace-finance';
import { loadProductsForImport } from './marketplace-catalog';
import type { startMarketplaceSync } from './marketplace-sync';

export const syncHandlers: Parameters<typeof startMarketplaceSync>[0] = {
  snapshot: (connection, params) => {
    const credentials = decryptCredentials<{ clientId: string; apiKey: string }>(connection.credentialsCiphertext);
    if (!params.from || !params.to) throw new Error('Не задан период выгрузки.');
    return connection.marketplace === 'ozon'
      ? getOzonSnapshot(credentials, params.from, params.to)
      : getWildberriesSnapshot(credentials, params.from, params.to, true);
  },
  finance: (connection, params) => {
    const credentials = decryptCredentials<{ clientId: string; apiKey: string }>(connection.credentialsCiphertext);
    if (!params.from || !params.to) throw new Error('Не задан период выгрузки.');
    return connection.marketplace === 'ozon'
      ? getOzonFinanceReport(credentials, params.from, params.to)
      : getWildberriesFinanceReport(credentials.apiKey, params.from, params.to);
  },
  catalog: (connection) => loadProductsForImport(connection.marketplace as 'ozon' | 'wildberries', decryptCredentials(connection.credentialsCiphertext)),
};
