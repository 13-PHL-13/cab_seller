-- Apply after backing up the database. Safe to rerun after the table is created.
CREATE TABLE IF NOT EXISTS cogs_product_marketplaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES cogs_products(id) ON DELETE CASCADE,
  marketplace text NOT NULL,
  marketplace_sku text NOT NULL DEFAULT '',
  external_product_id text NOT NULL DEFAULT '',
  publication_status text NOT NULL DEFAULT 'draft',
  imported_at timestamptz,
  last_published_at timestamptz,
  marketplace_data text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cogs_product_marketplaces_product_marketplace_unique
  ON cogs_product_marketplaces (product_id, marketplace);
CREATE UNIQUE INDEX IF NOT EXISTS cogs_product_marketplaces_owner_marketplace_sku_unique
  ON cogs_product_marketplaces (owner_id, marketplace, marketplace_sku);
CREATE INDEX IF NOT EXISTS cogs_product_marketplaces_owner_idx
  ON cogs_product_marketplaces (owner_id, marketplace);

-- Expand the old single `marketplace` column, including legacy `both` products.
INSERT INTO cogs_product_marketplaces (owner_id, product_id, marketplace, marketplace_sku, publication_status)
SELECT owner_id, id, 'ozon', seller_sku, publication_status
FROM cogs_products
WHERE marketplace IN ('ozon', 'both')
ON CONFLICT DO NOTHING;

INSERT INTO cogs_product_marketplaces (owner_id, product_id, marketplace, marketplace_sku, publication_status)
SELECT owner_id, id, 'wildberries', seller_sku, publication_status
FROM cogs_products
WHERE marketplace IN ('wildberries', 'both')
ON CONFLICT DO NOTHING;
