import { decryptCredentials } from './marketplace-credentials';
import { getOzonSnapshot, getWildberriesSnapshot } from './marketplace-data';
import { getOzonFinanceReport } from './marketplace-finance-ozon';
import { getWildberriesFinanceReport } from './marketplace-finance';
import { loadProductsForImport } from './marketplace-catalog';
import { sharedDataset,type startMarketplaceSync } from './marketplace-sync';
import {getOzonSubscription,type OzonSubscription} from './ozon-subscription';
import {SyncRejected} from './sync-context';
import { getOzonBuyouts } from './ozon-buyouts';

export const syncHandlers: Parameters<typeof startMarketplaceSync>[0] = {
  subscription:(connection)=>getOzonSubscription(decryptCredentials(connection.credentialsCiphertext)),
  buyouts: async(connection,params)=>{
    if(connection.marketplace!=='ozon' || !params.from || !params.to)throw new Error('Не задан период реализации Ozon.');
    const subscription=await sharedDataset<OzonSubscription>(connection,'subscription',{});
    if(!subscription.sync.stale && subscription.advancedAnalytics===false)throw new SyncRejected(403,'subscription');
    return getOzonBuyouts(decryptCredentials(connection.credentialsCiphertext),params.from,params.to);
  },
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
