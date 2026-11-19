import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRouterBalance,routerBalance } from './ai-balance.ts';
test('unknown balance never becomes a fictitious zero',()=>{
 for(const data of [null,{}, {data:{}},{data:{credits:''}},{data:{credits:'bad'}},{data:{credits:Infinity}}])assert.equal(parseRouterBalance(data),null);
 assert.equal(parseRouterBalance({data:{credits:'12.34'}}),12.34);
 assert.equal(parseRouterBalance({data:{credits:0}}),0);
});
test('balance uses only the official provider and does not return credentials',async()=>{
 const amount=await routerBalance('private-test-key',async(url,options)=>{
  assert.equal(url,'https://routerai.ru/api/v1/credits');assert.equal(options?.redirect,'error');
  return Response.json({data:{credits:51.25}});
 });assert.equal(amount,51.25);
 assert.equal(await routerBalance('private-test-key',async()=>new Response('bad',{status:403})),null);
});
