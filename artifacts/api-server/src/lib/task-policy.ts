export type TaskState = 'open' | 'in_progress' | 'review' | 'revision' | 'completed' | 'archived';
export type TaskAction = 'start' | 'submit' | 'accept' | 'revise' | 'delegate';
export function taskTransition(task: { status: TaskState; createdBy: string; assigneeUserId: string | null }, actor: string, action: TaskAction, comment = ''): TaskState {
  const working = ['open', 'in_progress', 'revision'].includes(task.status);
  if (action === 'start' && task.assigneeUserId === actor && task.status === 'open') return 'in_progress';
  if (action === 'submit' && task.assigneeUserId === actor && working && comment.trim()) return 'review';
  if (action === 'delegate' && task.assigneeUserId === actor && working) return 'open';
  if (action === 'accept' && task.createdBy === actor && task.status === 'review') return 'completed';
  if (action === 'revise' && task.createdBy === actor && task.status === 'review' && comment.trim()) return 'revision';
  throw new Error('Это действие недоступно. Для сдачи результата или возврата на доработку напишите комментарий.');
}
export function validateDeadline(date: unknown, time: unknown, now = new Date()): { dueDate: string; dueTime: string | null } {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))) throw new Error('Укажите корректную дату и время выполнения.');
  const dueTime = typeof time === 'string' && time ? time : null;
  const parsed = new Date(`${date}T${dueTime || '23:59:59'}+05:00`);
  if (!Number.isFinite(parsed.getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date || parsed <= now) throw new Error('Дата выполнения не должна быть в прошлом.');
  return { dueDate: date, dueTime };
}
