import test from 'node:test';
import assert from 'node:assert/strict';
import { completeSum,change,calendarDays } from '../src/lib/dashboard-model.ts';
test('aggregate is unavailable when any selected store is missing, while a verified zero stays zero',()=>{
 assert.equal(completeSum([]),null);assert.equal(completeSum([100,null]),null);assert.equal(completeSum([100,undefined]),null);assert.equal(completeSum([NaN,3]),null);assert.equal(completeSum([0,0]),0);assert.equal(completeSum([12,8]),20);
});
test('a comparison does not invent a previous baseline or divide by zero',()=>{
 assert.equal(change(10,null),null);assert.equal(change(null,10),null);assert.equal(change(10,0),null);assert.equal(change(120,100),20);assert.equal(change(80,100),-20);
});
test('calendar axis includes exactly the real dates, including a leap day and month boundary',()=>{
 assert.deepEqual(calendarDays('2024-02-28','2024-03-01'),['2024-02-28','2024-02-29','2024-03-01']);assert.equal(calendarDays('2026-11-07','2026-11-20').length,14);
});
