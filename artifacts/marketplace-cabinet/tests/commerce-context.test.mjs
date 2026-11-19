import test from 'node:test';import assert from 'node:assert/strict';
import {commerceContext} from '../src/commerce/context.ts';
test('large attached contexts remain bounded valid JSON and disclose truncation',()=>{
 const payload=commerceContext({section:'Себестоимость',reference:'/costs?tab=manual'},{records:Array.from({length:1000},(_,i)=>({sku:String(i),text:'A'.repeat(3000),cost:null}))});
 assert.ok(payload.length<=19000);const parsed=JSON.parse(payload);assert.equal(parsed.reference,'/costs?tab=manual');assert.ok(parsed.note.includes('не полный'));assert.equal(parsed.data.records[0].cost,null);
});
