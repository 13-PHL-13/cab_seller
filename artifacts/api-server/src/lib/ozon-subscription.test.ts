import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOzonSubscription,safeSellerInfo,metricAccessReason,PREMIUM_REQUIRED} from './ozon-subscription.ts';

test('seller-info distinguishes the exact Ozon subscription tiers',()=>{
  for(const [type,label,advanced] of [['UNSPECIFIED','Без Премиум',false],['PREMIUM_LITE','Premium Lite',false],['PREMIUM','Premium',false],['PREMIUM_PLUS','Premium Plus',true],['PREMIUM_PRO','Premium Pro',true]] as const){
    const actual=parseOzonSubscription({subscription:{type,is_premium:type!=='UNSPECIFIED'}});
    assert.equal(actual.type,type);assert.equal(actual.label,label);assert.equal(actual.advancedAnalytics,advanced);
  }
});
test('unknown or contradictory subscription replies never grant or invent a tier',()=>{
  assert.equal(parseOzonSubscription({}).type,'UNKNOWN');
  assert.equal(parseOzonSubscription({subscription:{type:'Профессиональный',is_premium:true}}).advancedAnalytics,null);
  assert.equal(parseOzonSubscription({subscription:{type:'PREMIUM_PRO',is_premium:false}}).type,'UNKNOWN');
  assert.equal(parseOzonSubscription({subscription:{type:'UNSPECIFIED',is_premium:true}}).type,'UNKNOWN');
});
test('only subscription fields survive the seller-info privacy boundary',()=>{
  assert.deepEqual(safeSellerInfo({company:{inn:'private-tax-id',legal_name:'private-name'},ratings:[{premium:true}],subscription:{type:'PREMIUM_PLUS',is_premium:true,secret:'private'}}),{subscription:{type:'PREMIUM_PLUS',is_premium:true}});
});
test('subscription labels cannot conceal permissions, rate limits or transport failures',()=>{
  const lite=parseOzonSubscription({subscription:{type:'PREMIUM_LITE',is_premium:true}});
  const plus=parseOzonSubscription({subscription:{type:'PREMIUM_PLUS',is_premium:true}});
  assert.equal(metricAccessReason(lite,'Ozon не передал показатель «просмотры».'),PREMIUM_REQUIRED);
  for(const message of ['Ошибка HTTP 401','Права API отклонены: 403','Данные загружаются в фоне.','Площадка не ответила.'])assert.equal(metricAccessReason(lite,message),message);
  assert.equal(metricAccessReason(undefined,'subscription gate',true),PREMIUM_REQUIRED);
  assert.notEqual(metricAccessReason(plus,'subscription gate',true),PREMIUM_REQUIRED);
  assert.equal(metricAccessReason(undefined,'Ozon не передал показатель.'),'Ozon не передал показатель.');
});
