import test from 'node:test';
import assert from 'node:assert/strict';
import { taskTransition, validateDeadline } from './task-policy.ts';
const task = {status:'in_progress' as const,createdBy:'owner',assigneeUserId:'employee'};
test('only assignee submits a result, only creator accepts it',()=>{
 assert.throws(()=>taskTransition(task,'owner','submit','готово'));
 assert.throws(()=>taskTransition(task,'employee','submit',''));
 assert.equal(taskTransition(task,'employee','submit','готово'),'review');
 assert.throws(()=>taskTransition({...task,status:'review'},'employee','accept'));
 assert.equal(taskTransition({...task,status:'review'},'owner','accept'),'completed');
});
test('revision requires actionable comment and delegation is limited to active work',()=>{
 assert.throws(()=>taskTransition({...task,status:'review'},'owner','revise',' '));
 assert.equal(taskTransition({...task,status:'review'},'owner','revise','исправить расчёт'),'revision');
 assert.equal(taskTransition(task,'employee','delegate'),'open');
 assert.throws(()=>taskTransition({...task,status:'completed'},'employee','delegate'));
});
test('deadline validates real calendar dates, local time and future dates',()=>{
 const now=new Date('2026-11-19T00:00:00Z');
 assert.deepEqual(validateDeadline('2026-11-20','12:30',now),{dueDate:'2026-11-20',dueTime:'12:30'});
 for(const [date,time] of [['2026-02-30',''],['2026-11-20','24:00'],['2026-11-18','12:00']]) assert.throws(()=>validateDeadline(date,time,now));
});
