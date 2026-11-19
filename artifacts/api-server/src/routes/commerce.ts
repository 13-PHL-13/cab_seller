import { Router, type IRouter } from "express";
import {
  db,
  pool,
  cogsProductsTable,
  cogsProductMarketplacesTable,
  cogsCostHistoryTable,
  marketplaceConnectionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireUser } from "../middlewares/requireUser";
import {
  requireCompanyFinance,
  requireCompanySection,
} from "../middlewares/requireCompanyAccess";
import {
  commercePermissions,
  commerceWriteAllowed,
  validateCommerceState,
} from "../lib/commerce-policy";
const router: IRouter = Router();
router.use(
  "/commerce",
  requireUser,
  requireCompanySection("products"),
  requireCompanyFinance,
);
router.use("/commerce", (req, res, next) => {
  if (!commercePermissions(req.companyRole, req.companyPermissions).allStores) {
    res
      .status(403)
      .json({
        error:
          "Для общего расчёта товаров компании нужен доступ ко всем её магазинам.",
      });
    return;
  }
  next();
});

export async function ensureCommerceSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS commerce_state (
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 kind text NOT NULL, state jsonb NOT NULL, revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,kind))`);
}
router.get("/commerce/bootstrap", async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const [states, products, links, history, connections] = await Promise.all([
      pool.query(
        "SELECT kind,state,revision FROM commerce_state WHERE company_id=$1",
        [companyId],
      ),
      db
        .select()
        .from(cogsProductsTable)
        .where(eq(cogsProductsTable.companyId, companyId)),
      db
        .select()
        .from(cogsProductMarketplacesTable)
        .where(eq(cogsProductMarketplacesTable.companyId, companyId)),
      db
        .select()
        .from(cogsCostHistoryTable)
        .where(eq(cogsCostHistoryTable.companyId, companyId)),
      db
        .select({
          id: marketplaceConnectionsTable.id,
          name: marketplaceConnectionsTable.storeName,
          marketplace: marketplaceConnectionsTable.marketplace,
        })
        .from(marketplaceConnectionsTable)
        .where(eq(marketplaceConnectionsTable.companyId, companyId)),
    ]);
    const state = Object.fromEntries(
      states.rows.map((r) => [
        r.kind,
        { state: r.state, revision: r.revision },
      ]),
    );
    const records = [];
    for (const p of products) {
      if (Number(p.unitCost) === 0 && p.publicationStatus === "imported")
        continue;
      records.push({
        sku: p.sellerSku,
        cost: Number(p.unitCost),
        scope:
          p.marketplace === "both"
            ? "all"
            : p.marketplace === "wildberries"
              ? "wb"
              : "ozon",
        source: "Каталог товаров",
        at: p.updatedAt.toISOString(),
      });
    }
    const stores = connections
      .filter((s) => ["ozon", "wildberries"].includes(s.marketplace))
      .map((s) => ({
        id: String(s.id),
        name: s.name,
        platform: s.marketplace === "wildberries" ? "wb" : "ozon",
      }));
    const listings = [];
    for (const p of products) {
      const identities = links.filter((l) => l.productId === p.id);
      const markets = identities.length
        ? identities.map((l) => l.marketplace)
        : p.marketplace === "both"
          ? ["ozon", "wildberries"]
          : [p.marketplace];
      for (const market of new Set(markets)) {
        const matches = stores.filter(
          (s) => s.platform === (market === "wildberries" ? "wb" : market),
        );
        // The legacy catalog has marketplace identity, but no store identity. Never fan
        // the same catalog out into several stores and claim those are verified offers.
        if (matches.length !== 1) continue;
        const identity = identities.find((l) => l.marketplace === market);
        const costHistory = history
          .filter(
            (h) =>
              h.productId === p.id &&
              !(Number(h.unitCost) === 0 && p.publicationStatus === "imported"),
          )
          .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
        const daily = new Map(
          costHistory.map((h) => [
            h.effectiveAt.toISOString().slice(0, 10),
            {
              from: h.effectiveAt.toISOString().slice(0, 10),
              cost: Number(h.unitCost),
            },
          ]),
        );
        listings.push({
          id: p.id,
          storeId: matches[0].id,
          sku: identity?.marketplaceSku || p.sellerSku,
          costSku: p.sellerSku,
          name: p.productName,
          costHistory: [...daily.values()],
          fbo: null,
          fbs: null,
        });
      }
    }
    res.json({
      companyId,
      states: state,
      records,
      stores,
      listings,
      updatedAt: new Date().toISOString(),
      permissions: commercePermissions(req.companyRole, req.companyPermissions),
      notice:
        "Операции продаж и расходов по каждому товару пока не доступны. Недостающие показатели отмечены «Нет данных». Каталог привязан к магазину только при единственном подключении площадки.",
    });
  } catch (e) {
    next(e);
  }
});
router.put("/commerce/:kind", async (req, res, next) => {
  const kind = String(req.params.kind);
  let state: Record<string, any>;
  try {
    state = validateCommerceState(kind, req.body?.state);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }
  if (!Number.isSafeInteger(req.body.revision) || req.body.revision < 0) {
    res.status(400).json({ error: "Обновите расчёт перед сохранением." });
    return;
  }
  const permissions = commercePermissions(
      req.companyRole,
      req.companyPermissions,
    ),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${req.companyId}:${kind}`,
    ]);
    const old = (
      await client.query(
        "SELECT state,revision FROM commerce_state WHERE company_id=$1 AND kind=$2 FOR UPDATE",
        [req.companyId, kind],
      )
    ).rows[0];
    if ((old?.revision ?? 0) !== req.body.revision) {
      await client.query("ROLLBACK");
      res
        .status(409)
        .json({
          error:
            "Расчёт уже изменён в другом окне. Ваши изменения не записаны. Сохраните введённые значения и обновите страницу.",
        });
      return;
    }
    if (!commerceWriteAllowed(kind, old?.state ?? null, state, permissions)) {
      await client.query("ROLLBACK");
      res
        .status(403)
        .json({
          error: "Нет права изменять себестоимость или утверждать цены.",
        });
      return;
    }
    const result = await client.query(
      "INSERT INTO commerce_state(company_id,kind,state,revision) VALUES($1,$2,$3,1) ON CONFLICT(company_id,kind) DO UPDATE SET state=$3,revision=commerce_state.revision+1,updated_at=now() RETURNING revision",
      [req.companyId, kind, JSON.stringify(state)],
    );
    await client.query("COMMIT");
    res.json({ revision: result.rows[0].revision });
  } catch (e) {
    await client.query("ROLLBACK");
    next(e);
  } finally {
    client.release();
  }
});
export default router;
