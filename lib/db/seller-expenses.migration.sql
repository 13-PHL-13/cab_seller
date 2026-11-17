CREATE TABLE IF NOT EXISTS seller_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_date text NOT NULL,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'RUB',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_expenses_owner_date_idx
  ON seller_expenses(owner_id, expense_date);
