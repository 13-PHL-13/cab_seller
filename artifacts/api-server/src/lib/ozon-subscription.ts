import {providerFetch} from './sync-context.ts';

export const PREMIUM_REQUIRED='Требуется Премиум на Озон';
export type OzonSubscription={type:string;label:string;isPremium:boolean|null;advancedAnalytics:boolean|null;checkedAt:string|null};
const tiers:Record<string,{label:string;advanced:boolean}>={
  UNSPECIFIED:{label:'Без Премиум',advanced:false},
  PREMIUM_LITE:{label:'Premium Lite',advanced:false},
  PREMIUM:{label:'Premium',advanced:false},
  PREMIUM_PLUS:{label:'Premium Plus',advanced:true},
  PREMIUM_PRO:{label:'Premium Pro',advanced:true},
};
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'?value as Record<string,unknown>:{};}

// The seller-info response also contains company tax identifiers and ratings.
// Retain only the subscription fields used by this application.
export function safeSellerInfo(value:unknown){
  const subscription=record(record(value).subscription);
  return {subscription:{type:typeof subscription.type==='string'?subscription.type.slice(0,64):'UNKNOWN',is_premium:typeof subscription.is_premium==='boolean'?subscription.is_premium:null}};
}
export function parseOzonSubscription(value:unknown):OzonSubscription {
  const subscription=safeSellerInfo(value).subscription;
  const isPremium=subscription.is_premium;
  let type=subscription.type;
  if(!tiers[type] || (type==='UNSPECIFIED'&&isPremium===true) || (type!=='UNSPECIFIED'&&isPremium===false))type='UNKNOWN';
  const tier=tiers[type];
  return {type,label:tier?.label??(isPremium===true?'Премиум — тип не уточнён':'Тариф не определён'),isPremium,advancedAnalytics:tier?.advanced??null,checkedAt:null};
}
export async function getOzonSubscription(credentials:{clientId:string;apiKey:string}):Promise<OzonSubscription>{
  const response=await providerFetch('https://api-seller.ozon.ru/v1/seller/info',{
    method:'POST',headers:{'Client-Id':credentials.clientId,'Api-Key':credentials.apiKey,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20_000),
  });
  if(!response.ok)throw new Error(`Ozon: не удалось определить подписку (HTTP ${response.status}).`);
  return parseOzonSubscription(await response.json());
}

export function metricAccessReason(subscription:OzonSubscription|undefined,existing:string|undefined,explicitSubscriptionError=false):string|undefined {
  if(!existing)return undefined;
  if(subscription?.advancedAnalytics===true && explicitSubscriptionError)return 'Ozon отклонил доступ при активном Премиум. Проверьте права ключа и статус услуги.';
  if(explicitSubscriptionError)return PREMIUM_REQUIRED;
  if(/\b(?:401|403|429)\b|в фоне|загружается|права|ключ|не удалось|не ответ/i.test(existing))return existing;
  if(subscription?.advancedAnalytics===false)return PREMIUM_REQUIRED;
  // An empty metric or generic permission error alone is not evidence of a missing plan.
  return existing.replace(/: расширенная аналитика API требует Premium Plus или Premium Pro\.?/g,'.');
}
