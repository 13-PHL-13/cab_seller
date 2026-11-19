import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { Router, type IRouter } from 'express';
import { db, companyMembershipsTable, companyTaskMessagesTable, companyTasksTable, usersTable } from '@workspace/db';
import { requireUser } from '../middlewares/requireUser';
import { requireCompanySection } from '../middlewares/requireCompanyAccess';
import { taskTransition, validateDeadline, type TaskAction } from '../lib/task-policy';
const router: IRouter = Router();
router.use('/tasks', requireUser, requireCompanySection('tasks'));
const uuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id);
const canIssue = (req: import('express').Request) => req.companyRole === 'owner' || req.companyRole === 'admin' || Boolean(req.companyPermissions?.canIssueTasks);
const involved = (task: {createdBy:string;assigneeUserId:string|null;delegators:string[]}, id:string) => task.createdBy === id || task.assigneeUserId === id || task.delegators.includes(id);
router.get('/tasks', async(req,res,next)=>{
 try {
  const rows=await db.select().from(companyTasksTable).where(and(eq(companyTasksTable.companyId,req.companyId!),or(eq(companyTasksTable.createdBy,req.userId!),eq(companyTasksTable.assigneeUserId,req.userId!),sql`${req.userId!} = ANY(${companyTasksTable.delegators})`))).orderBy(desc(companyTasksTable.updatedAt));
  const ids=rows.map(t=>t.id);
  const messages=ids.length?await db.select().from(companyTaskMessagesTable).where(inArray(companyTaskMessagesTable.taskId,ids)).orderBy(companyTaskMessagesTable.createdAt):[];
  const users=await db.select({id:usersTable.id,email:usersTable.email}).from(usersTable).innerJoin(companyMembershipsTable,eq(usersTable.id,companyMembershipsTable.userId)).where(eq(companyMembershipsTable.companyId,req.companyId!));
  const names=new Map(users.map(u=>[u.id,u.email]));
  res.json({tasks:rows.map(t=>({...t,creatorEmail:names.get(t.createdBy),assigneeEmail:names.get(t.assigneeUserId??''),messages:messages.filter(m=>m.taskId===t.id).map(m=>({...m,authorEmail:names.get(m.authorUserId)}))}))});
 }catch(error){next(error);}
});
router.post('/tasks',async(req,res,next)=>{
 try{
  if(!canIssue(req)){res.status(403).json({error:'У вашей роли нет права выдавать поручения.'});return;}
  const title=typeof req.body?.title==='string'?req.body.title.trim().slice(0,180):'';
  const description=typeof req.body?.description==='string'?req.body.description.trim().slice(0,4000):'';
  const assignee=req.body?.assigneeUserId;
  if(!title||!uuid(assignee)||assignee===req.userId){res.status(400).json({error:'Укажите поручение и выберите другого исполнителя.'});return;}
  let deadline;try{deadline=validateDeadline(req.body?.dueDate,req.body?.dueTime);}catch(error){res.status(400).json({error:(error as Error).message});return;}
  const result=await db.transaction(async tx=>{
   const [member]=await tx.select({id:companyMembershipsTable.userId}).from(companyMembershipsTable).where(and(eq(companyMembershipsTable.companyId,req.companyId!),eq(companyMembershipsTable.userId,assignee),sql`(${companyMembershipsTable.role} IN ('owner','admin') OR ${companyMembershipsTable.sections} ? 'tasks')`)).limit(1);
   if(!member)throw new Error('У исполнителя нет доступа к поручениям этой компании.');
   const raw=req.body?.context;
   const context=raw&&typeof raw==='object'?{section:String(raw.section??'').slice(0,200),stores:String(raw.stores??'').slice(0,300),period:String(raw.period??'').slice(0,100)}:null;
   const [task]=await tx.insert(companyTasksTable).values({companyId:req.companyId!,createdBy:req.userId!,assigneeUserId:assignee,title,description,...deadline,context}).returning();
   await tx.insert(companyTaskMessagesTable).values({taskId:task.id,authorUserId:req.userId!,body:'Создано поручение',type:'status'});return task;
  }).catch(error=>{if((error as Error).message==='У исполнителя нет доступа к поручениям этой компании.'){res.status(400).json({error:(error as Error).message});return null;}throw error;});
  if(result)res.status(201).json(result);
 }catch(error){next(error);}
});
router.patch('/tasks/:id',async(req,res,next)=>{
 if(!uuid(req.params.id)){res.status(404).json({error:'Поручение не найдено.'});return;}
 try{
  const result=await db.transaction(async tx=>{
   const [task]=await tx.select().from(companyTasksTable).where(and(eq(companyTasksTable.id,req.params.id),eq(companyTasksTable.companyId,req.companyId!))).for('update').limit(1);
   if(!task||!involved(task,req.userId!))return {code:404,error:'Поручение не найдено.'};
   const body=typeof req.body?.body==='string'?req.body.body.trim().slice(0,4000):'';
   const action=req.body?.action as TaskAction;
   let status;try{status=taskTransition(task,req.userId!,action,body);}catch(error){return {code:403,error:(error as Error).message};}
   const update:Partial<typeof companyTasksTable.$inferInsert>={status,updatedAt:new Date()};
   let system={start:'Взял в работу',submit:'Поручение направлено постановщику на проверку.',accept:'Результат принят. Поручение выполнено.',revise:'Поручение возвращено исполнителю на доработку.',delegate:'Поручение передано другому исполнителю.'}[action];
   if(action==='delegate'){
    const target=req.body?.assigneeUserId;
    if(!uuid(target)||target===req.userId||target===task.createdBy)return {code:400,error:'Выберите другого исполнителя.'};
    const [member]=await tx.select({email:usersTable.email}).from(companyMembershipsTable).innerJoin(usersTable,eq(usersTable.id,companyMembershipsTable.userId)).where(and(eq(companyMembershipsTable.companyId,req.companyId!),eq(companyMembershipsTable.userId,target),sql`(${companyMembershipsTable.role} IN ('owner','admin') OR ${companyMembershipsTable.sections} ? 'tasks')`)).limit(1);
    if(!member)return {code:400,error:'У исполнителя нет доступа к поручениям этой компании.'};
    update.assigneeUserId=target;update.delegators=[...new Set([...task.delegators,req.userId!])];system=`Поручение передано: ${member.email}. Первоначальный постановщик сохранён.`;
   }
   if(body)await tx.insert(companyTaskMessagesTable).values({taskId:task.id,authorUserId:req.userId!,body});
   await tx.insert(companyTaskMessagesTable).values({taskId:task.id,authorUserId:req.userId!,body:system,type:'status'});
   const [updated]=await tx.update(companyTasksTable).set(update).where(eq(companyTasksTable.id,task.id)).returning();return {code:200,task:updated};
  });
  res.status(result.code).json(result.error?{error:result.error}:result.task);
 }catch(error){next(error);}
});
router.post('/tasks/:id/messages',async(req,res,next)=>{
 if(!uuid(req.params.id)){res.status(404).json({error:'Поручение не найдено.'});return;}
 try{
  const [task]=await db.select().from(companyTasksTable).where(and(eq(companyTasksTable.id,req.params.id),eq(companyTasksTable.companyId,req.companyId!))).limit(1);
  if(!task||!involved(task,req.userId!)){res.status(404).json({error:'Поручение не найдено.'});return;}
  const body=typeof req.body?.body==='string'?req.body.body.trim().slice(0,4000):'';
  if(!body){res.status(400).json({error:'Введите комментарий.'});return;}
  const [message]=await db.insert(companyTaskMessagesTable).values({taskId:task.id,authorUserId:req.userId!,body}).returning();res.status(201).json(message);
 }catch(error){next(error);}
});
export default router;
