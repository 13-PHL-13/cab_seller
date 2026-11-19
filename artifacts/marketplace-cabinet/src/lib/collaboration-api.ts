import type { BlockContext } from './dashboard-model';
export type TaskStatus='open'|'in_progress'|'review'|'revision'|'completed'|'archived';
export interface TaskMessage {id:string;authorUserId:string;authorEmail?:string;body:string;type:string;createdAt:string}
export interface Task {id:string;title:string;description:string;createdBy:string;creatorEmail?:string;assigneeUserId:string|null;assigneeEmail?:string;delegators:string[];dueDate:string|null;dueTime:string|null;status:TaskStatus;context:BlockContext|null;messages:TaskMessage[]}
export interface Chat {id:string;title:string;archived:boolean;context:string;updatedAt:string}
export interface ChatMessage {role:'user'|'assistant';content:string;createdAt?:string}
export interface AiStatus {configured:boolean;model:string;balance:number|null;currency:string|null;tokensRemaining:number|null;expiresAt:string|null;tokenLimit?:number|null}
export async function workspaceRequest<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch(path,{...init,credentials:'include',headers:{...(init?.body?{'Content-Type':'application/json'}:{}),...init?.headers}});
 const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.error??`Ошибка сервера (${response.status}).`);return data as T;
}
export const taskStatuses:Record<TaskStatus,string>={open:'Назначено',in_progress:'В работе',review:'На проверке',revision:'На доработке',completed:'Выполнено',archived:'Выполнено'};
export const finished=(t:Task)=>t.status==='completed'||t.status==='archived';
export function deadline(t:Task){return t.dueDate?`${t.dueDate.split('-').reverse().join('.')}${t.dueTime?', '+t.dueTime:''}`:'Не указан';}
export function overdue(t:Task){return !finished(t)&&!!t.dueDate&&new Date(`${t.dueDate}T${t.dueTime||'23:59:59'}+05:00`)<new Date();}
