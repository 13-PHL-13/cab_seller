import { useEffect, useState, type FormEvent } from "react";
import { Archive, CalendarDays, Plus, Send, UserRound } from "lucide-react";
import { getWorkspace } from "@/lib/workspace-api";
import type { WorkspaceMember } from "@/lib/workspace-api";

type TaskStatus = "open" | "in_progress" | "review" | "completed" | "archived";
type TaskPriority = "low" | "normal" | "high" | "urgent";
interface TaskMessage { id: string; authorUserId: string; authorEmail?: string; body: string; type: string; createdAt: string }
interface Task { id: string; title: string; description: string; status: TaskStatus; priority: TaskPriority; dueDate: string | null; assigneeUserId: string | null; assigneeEmail?: string | null; createdAt: string; updatedAt: string; messages: TaskMessage[] }

const STATUSES: Array<{ id: TaskStatus; label: string }> = [
  { id: "open", label: "Новые" }, { id: "in_progress", label: "В работе" }, { id: "review", label: "На проверке" }, { id: "completed", label: "Готово" }, { id: "archived", label: "Архив" },
];
const PRIORITIES: Record<TaskPriority, string> = { low: "Низкий", normal: "Обычный", high: "Высокий", urgent: "Срочно" };
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "include", headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `Ошибка сервера (${response.status}).`);
  return payload as T;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]); const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [dueDate, setDueDate] = useState(""); const [assignee, setAssignee] = useState(""); const [priority, setPriority] = useState<TaskPriority>("normal");
  const [comments, setComments] = useState<Record<string, string>>({}); const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [canCreate, setCanCreate] = useState(false);
  async function refresh() {
    setError("");
    try { const [{ tasks }, workspace] = await Promise.all([api<{ tasks: Task[] }>("/api/tasks"), getWorkspace()]); setTasks(tasks); setMembers(workspace.members); setCanCreate(workspace.role === "owner" || workspace.role === "admin" || Boolean(workspace.members.find((member) => member.userId === workspace.currentUserId)?.canIssueTasks)); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить задачи."); }
  }
  useEffect(() => { void refresh(); }, []);
  async function create(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api("/api/tasks", { method: "POST", body: JSON.stringify({ title, description, dueDate: dueDate || null, priority, assigneeUserId: assignee || null }) }); setTitle(""); setDescription(""); setDueDate(""); setAssignee(""); setPriority("normal"); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось создать задачу."); } finally { setBusy(false); } }
  async function changeStatus(taskId: string, status: TaskStatus) { setBusy(true); setError(""); try { await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status }) }); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось изменить статус."); } finally { setBusy(false); } }
  async function assign(taskId: string, assigneeUserId: string) { setBusy(true); setError(""); try { await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ assigneeUserId: assigneeUserId || null }) }); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось передать задачу."); } finally { setBusy(false); } }
  async function comment(event: FormEvent, taskId: string) { event.preventDefault(); const body = comments[taskId]?.trim(); if (!body) return; setBusy(true); setError(""); try { await api(`/api/tasks/${taskId}/messages`, { method: "POST", body: JSON.stringify({ body }) }); setComments((current) => ({ ...current, [taskId]: "" })); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось отправить комментарий."); } finally { setBusy(false); } }

  const visible = tasks.filter((task) => showArchived ? task.status === "archived" : task.status !== "archived");
  return <div className="page">
    <header className="page-header"><div><h1>Задачи</h1><p>Поручения команды, сроки, обсуждения и передача на проверку</p></div><button className="btn" onClick={() => void refresh()}>Обновить</button></header>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {canCreate && <section className="card" style={{ marginBottom: 22 }}><h2><Plus size={19} /> Новая задача</h2><form onSubmit={create} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название задачи" required maxLength={180} style={{ gridColumn: "1 / -1" }} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание, критерии готовности" rows={3} style={{ gridColumn: "1 / -1" }} />
      <select value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Без исполнителя</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.email}</option>)}</select>
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Срок выполнения" />
      <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>{Object.entries(PRIORITIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      <button className="btn btn-primary" disabled={busy}><Plus size={16} /> Создать</button>
    </form></section>}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><h2 style={{ margin: 0 }}>Рабочий список ({visible.length})</h2><button className="btn" onClick={() => setShowArchived((current) => !current)}><Archive size={16} /> {showArchived ? "Активные" : "Архив"}</button></div>
    {!visible.length ? <section className="card"><p>Задач пока нет. Создайте поручение для команды.</p></section> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
      {STATUSES.filter((status) => showArchived ? status.id === "archived" : status.id !== "archived").map((status) => <section key={status.id} className="card" style={{ minHeight: 180 }}><h3>{status.label} <small>({visible.filter((task) => task.status === status.id).length})</small></h3>
        {visible.filter((task) => task.status === status.id).map((task) => <article key={task.id} className="card" style={{ padding: 14, margin: "10px 0", boxShadow: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><b>{task.title}</b><span className={`badge priority-${task.priority}`}>{PRIORITIES[task.priority]}</span></div>
          {task.description && <p style={{ whiteSpace: "pre-wrap" }}>{task.description}</p>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13, color: "var(--muted, #667085)" }}>
            <span><UserRound size={14} /> {task.assigneeEmail ?? "Не назначена"}</span>{task.dueDate && <span><CalendarDays size={14} /> {new Date(`${task.dueDate}T00:00:00`).toLocaleDateString("ru-RU")}</span>}
          </div>
          {!showArchived && <div style={{ display: "flex", gap: 8, marginTop: 10 }}><select aria-label="Статус задачи" value={task.status} disabled={busy} onChange={(e) => void changeStatus(task.id, e.target.value as TaskStatus)}>{STATUSES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="archived">Архив</option></select><select aria-label="Передать задачу" value={task.assigneeUserId ?? ""} disabled={busy || !canCreate} onChange={(e) => void assign(task.id, e.target.value)}><option value="">Без исполнителя</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.email}</option>)}</select></div>}
          <details style={{ marginTop: 12 }}><summary>Обсуждение ({task.messages.length})</summary><div style={{ display: "grid", gap: 8, marginTop: 8 }}>{task.messages.map((item) => <div key={item.id} style={{ padding: 8, borderRadius: 8, background: "var(--surface, #f6f8f7)" }}><small><b>{item.authorEmail ?? "Участник"}</b> · {new Date(item.createdAt).toLocaleString("ru-RU")}</small><div>{item.body}</div></div>)}<form onSubmit={(e) => void comment(e, task.id)} style={{ display: "flex", gap: 8 }}><input value={comments[task.id] ?? ""} onChange={(e) => setComments((current) => ({ ...current, [task.id]: e.target.value }))} placeholder="Комментарий" maxLength={4000} /><button className="btn" disabled={busy} aria-label="Отправить комментарий"><Send size={15} /></button></form></div></details>
        </article>)}
      </section>)}
    </div>}
  </div>;
}
