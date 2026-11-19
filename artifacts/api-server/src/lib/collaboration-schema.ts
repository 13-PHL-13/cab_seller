import { pool } from '@workspace/db';
// Additive upgrade for existing installations, independent of Render's start command.
export async function ensureCollaborationSchema():Promise<void>{
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('navigator-collaboration-v1'))");
  await client.query(`
   ALTER TABLE company_tasks ADD COLUMN IF NOT EXISTS due_time text;
   ALTER TABLE company_tasks ADD COLUMN IF NOT EXISTS delegators text[] NOT NULL DEFAULT '{}';
   ALTER TABLE company_tasks ADD COLUMN IF NOT EXISTS context jsonb;
   ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
   ALTER TABLE company_tasks DROP CONSTRAINT IF EXISTS company_tasks_status_check;
   ALTER TABLE company_tasks ADD CONSTRAINT company_tasks_status_check CHECK (status IN ('open','in_progress','review','revision','completed','archived'));
  `);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
