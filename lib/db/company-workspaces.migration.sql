-- Company workspaces and shared-data ownership. Existing user data is copied
-- into a personal company before company_id becomes mandatory.
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'employee',
  sections jsonb NOT NULL DEFAULT '["dashboard","marketplaces","funnel","analytics","finance","products"]'::jsonb,
  store_access jsonb NOT NULL DEFAULT '"all"'::jsonb,
  can_see_finance boolean NOT NULL DEFAULT true,
  can_edit_cogs boolean NOT NULL DEFAULT false,
  can_approve_prices boolean NOT NULL DEFAULT false,
  can_issue_tasks boolean NOT NULL DEFAULT false,
  token_limit integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_memberships_role_check CHECK (role IN ('owner','admin','lead','employee')),
  CONSTRAINT company_memberships_company_user_unique UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'employee',
  sections jsonb NOT NULL DEFAULT '["dashboard","marketplaces","funnel","analytics","products"]'::jsonb,
  store_access jsonb NOT NULL DEFAULT '"all"'::jsonb,
  can_see_finance boolean NOT NULL DEFAULT false,
  can_edit_cogs boolean NOT NULL DEFAULT false,
  can_approve_prices boolean NOT NULL DEFAULT false,
  can_issue_tasks boolean NOT NULL DEFAULT false,
  token_limit integer,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_invitations_role_check CHECK (role IN ('admin','lead','employee'))
);

CREATE INDEX IF NOT EXISTS companies_owner_user_idx ON companies(owner_user_id);
CREATE INDEX IF NOT EXISTS company_memberships_user_idx ON company_memberships(user_id);
CREATE INDEX IF NOT EXISTS company_memberships_company_role_idx ON company_memberships(company_id, role);
CREATE INDEX IF NOT EXISTS company_invitations_company_email_idx ON company_invitations(company_id, email);
CREATE INDEX IF NOT EXISTS company_invitations_expires_idx ON company_invitations(expires_at);

-- Give every existing account a personal workspace. Owners keep all old data.
INSERT INTO companies (owner_user_id, name)
SELECT u.id, COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'Моя компания')
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM company_memberships m WHERE m.user_id = u.id)
ON CONFLICT DO NOTHING;

INSERT INTO company_memberships (company_id, user_id, role)
SELECT c.id, c.owner_user_id, 'owner'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM company_memberships m
  WHERE m.company_id = c.id AND m.user_id = c.owner_user_id
)
ON CONFLICT (company_id, user_id) DO NOTHING;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
UPDATE sessions s SET active_company_id = (
  SELECT m.company_id FROM company_memberships m WHERE m.user_id = s.user_id ORDER BY m.created_at LIMIT 1
) WHERE s.active_company_id IS NULL;

ALTER TABLE marketplace_connections ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
UPDATE marketplace_connections mc SET company_id = m.company_id
FROM company_memberships m WHERE mc.company_id IS NULL AND m.user_id::text = mc.owner_id
  AND m.role = 'owner';
-- Defensive fallback for legacy non-UUID owner strings, if any.
UPDATE marketplace_connections mc SET company_id = c.id
FROM companies c WHERE mc.company_id IS NULL AND c.owner_user_id::text = mc.owner_id;
ALTER TABLE marketplace_connections ALTER COLUMN company_id SET NOT NULL;
DROP INDEX IF EXISTS marketplace_connections_owner_marketplace_unique;
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_connections_company_marketplace_store_unique
  ON marketplace_connections(company_id, marketplace, store_name);
CREATE INDEX IF NOT EXISTS marketplace_connections_company_idx ON marketplace_connections(company_id);

ALTER TABLE marketplace_connections ADD COLUMN IF NOT EXISTS analytics_retry_at timestamptz;

ALTER TABLE cogs_products ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
UPDATE cogs_products p SET company_id = m.company_id FROM company_memberships m
WHERE p.company_id IS NULL AND p.owner_id = m.user_id AND m.role = 'owner';
ALTER TABLE cogs_products ALTER COLUMN company_id SET NOT NULL;
DROP INDEX IF EXISTS cogs_products_owner_marketplace_sku_unique;
DROP INDEX IF EXISTS cogs_products_company_marketplace_sku_unique;
CREATE UNIQUE INDEX IF NOT EXISTS cogs_products_company_marketplace_sku_unique
  ON cogs_products(company_id, marketplace, seller_sku);
CREATE INDEX IF NOT EXISTS cogs_products_company_idx ON cogs_products(company_id);

ALTER TABLE cogs_cost_history ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
UPDATE cogs_cost_history h SET company_id = p.company_id FROM cogs_products p
WHERE h.company_id IS NULL AND h.product_id = p.id;
ALTER TABLE cogs_cost_history ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS cogs_cost_history_company_product_idx
  ON cogs_cost_history(company_id, product_id, effective_at);

ALTER TABLE cogs_product_marketplaces ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
UPDATE cogs_product_marketplaces pm SET company_id = p.company_id FROM cogs_products p
WHERE pm.company_id IS NULL AND pm.product_id = p.id;
ALTER TABLE cogs_product_marketplaces ALTER COLUMN company_id SET NOT NULL;
DROP INDEX IF EXISTS cogs_product_marketplaces_owner_marketplace_sku_unique;
CREATE UNIQUE INDEX IF NOT EXISTS cogs_product_marketplaces_company_marketplace_sku_unique
  ON cogs_product_marketplaces(company_id, marketplace, marketplace_sku);
CREATE INDEX IF NOT EXISTS cogs_product_marketplaces_company_idx
  ON cogs_product_marketplaces(company_id, marketplace);

ALTER TABLE seller_expenses ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;
UPDATE seller_expenses e SET company_id = m.company_id FROM company_memberships m
WHERE e.company_id IS NULL AND e.owner_id = m.user_id AND m.role = 'owner';
ALTER TABLE seller_expenses ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS seller_expenses_company_date_idx ON seller_expenses(company_id, expense_date);

CREATE TABLE IF NOT EXISTS company_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','review','completed','archived')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_date text,
  assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_tasks_company_status_idx ON company_tasks(company_id,status,due_date);
CREATE INDEX IF NOT EXISTS company_tasks_assignee_idx ON company_tasks(assignee_user_id);

CREATE TABLE IF NOT EXISTS company_task_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES company_tasks(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'comment' CHECK (type IN ('comment','status','assignment')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_task_messages_task_created_idx ON company_task_messages(task_id,created_at);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Новый диалог',
  context text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conversations_company_updated_idx ON ai_conversations(company_id,updated_at);

CREATE TABLE IF NOT EXISTS ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx ON ai_messages(conversation_id,created_at);
