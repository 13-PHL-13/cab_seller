import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { getWorkspace,type Workspace } from '@/lib/workspace-api';
import { workspaceRequest as request,type Task } from '@/lib/collaboration-api';
import TaskDialogs from './TaskDialogs';
import './collaboration.css';
interface Collaboration {workspace:Workspace|null;tasks:Task[];error:string;refresh:()=>Promise<void>;openTask:(id:string)=>void;createTask:()=>void;canCreate:boolean}
const Context=createContext<Collaboration|null>(null);
export function useCollaboration(){const value=useContext(Context);if(!value)throw new Error('Missing collaboration provider');return value;}
export default function CollaborationProvider({children}:{children:ReactNode}){
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[tasks,setTasks]=useState<Task[]>([]),[error,setError]=useState(''),[active,setActive]=useState<string|null>(null),[creating,setCreating]=useState(false);
 const refresh=useCallback(async()=>{
  const ws=await getWorkspace();setWorkspace(ws);
  const member=ws.members.find(m=>m.userId===ws.currentUserId),allowed=ws.role==='owner'||ws.role==='admin'||member?.sections.includes('tasks');
  if(allowed){const result=await request<{tasks:Task[]}>('/api/tasks');setTasks(result.tasks);}else setTasks([]);
 },[]);
 useEffect(()=>{void refresh().catch(e=>setError(e.message));},[refresh]);
 const member=workspace?.members.find(m=>m.userId===workspace.currentUserId);
 const canCreate=!!workspace&&(workspace.role==='owner'||workspace.role==='admin'||!!member?.canIssueTasks);
 return <Context.Provider value={{workspace,tasks,error,refresh,openTask:setActive,createTask:()=>setCreating(true),canCreate}}>{children}<TaskDialogs task={tasks.find(t=>t.id===active)} creating={creating} close={()=>{setActive(null);setCreating(false);}} saved={async(id)=>{await refresh();setCreating(false);setActive(id);}} /></Context.Provider>;
}
