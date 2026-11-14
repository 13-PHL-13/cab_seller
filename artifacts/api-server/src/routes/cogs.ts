import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, cogsCostHistoryTable, cogsProductsTable } from "@workspace/db";
import { requireUser } from "../middlewares/requireUser";

const router: IRouter = Router();
router.use("/cogs", requireUser);

type Marketplace = "ozon" | "wildberries" | "both";
function parseBody(body: unknown): { marketplace: Marketplace; sellerSku: string; productName: string; unitCost: string } | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const marketplace = value.marketplace;
  const sellerSku = typeof value.sellerSku === "string" ? value.sellerSku.trim() : "";
  const productName = typeof value.productName === "string" ? value.productName.trim() : "";
  const rawCost = value.unitCost;
  const unitCost = typeof rawCost === "number" ? String(rawCost) : typeof rawCost === "string" ? rawCost.trim() : "";
  if (!["ozon", "wildberries", "both"].includes(String(marketplace))) return null;
  if (!sellerSku || sellerSku.length > 120 || !productName || productName.length > 240) return null;
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(unitCost)) return null;
  if (!Number.isFinite(Number(unitCost)) || Number(unitCost) < 0 || Number(unitCost) > 999999999999.99) return null;
  return { marketplace: marketplace as Marketplace, sellerSku, productName, unitCost: Number(unitCost).toFixed(2) };
}

function ownerId(req: import("express").Request): string {
  if (!req.userId) throw new Error("Authenticated user is missing");
  return req.userId;
}

router.get("/cogs", async (req, res): Promise<void> => {
  const rows = await db.select().from(cogsProductsTable)
    .where(eq(cogsProductsTable.ownerId, ownerId(req)))
    .orderBy(desc(cogsProductsTable.updatedAt));
  res.json(rows);
});

router.get("/cogs/:id/history", async (req, res): Promise<void> => {
  const userId = ownerId(req);
  const productId = req.params.id;
  const [product] = await db.select({ id: cogsProductsTable.id }).from(cogsProductsTable)
    .where(and(eq(cogsProductsTable.id, productId), eq(cogsProductsTable.ownerId, userId))).limit(1);
  if (!product) { res.status(404).json({ error: "Товар не найден." }); return; }
  const rows = await db.select().from(cogsCostHistoryTable)
    .where(and(eq(cogsCostHistoryTable.productId, productId), eq(cogsCostHistoryTable.ownerId, userId)))
    .orderBy(desc(cogsCostHistoryTable.effectiveAt));
  res.json(rows);
});

router.post("/cogs", async (req, res): Promise<void> => {
  const parsed = parseBody(req.body);
  if (!parsed) { res.status(400).json({ error: "Проверьте площадку, артикул, название и себестоимость (неотрицательное число, до 2 знаков)." }); return; }
  const userId = ownerId(req);
  const [existing] = await db.select({ id: cogsProductsTable.id }).from(cogsProductsTable).where(and(
    eq(cogsProductsTable.ownerId, userId), eq(cogsProductsTable.marketplace, parsed.marketplace), eq(cogsProductsTable.sellerSku, parsed.sellerSku),
  )).limit(1);
  if (existing) { res.status(409).json({ error: "Такой артикул для выбранной площадки уже есть. Измените существующую запись." }); return; }
  const [created] = await db.transaction(async (tx) => {
    const [product] = await tx.insert(cogsProductsTable).values({ ownerId: userId, ...parsed }).returning();
    await tx.insert(cogsCostHistoryTable).values({ ownerId: userId, productId: product.id, unitCost: parsed.unitCost });
    return [product];
  });
  res.status(201).json(created);
});

router.put("/cogs/:id", async (req, res): Promise<void> => {
  const parsed = parseBody(req.body);
  if (!parsed) { res.status(400).json({ error: "Проверьте площадку, артикул, название и себестоимость (неотрицательное число, до 2 знаков)." }); return; }
  const userId = ownerId(req);
  const [existing] = await db.select().from(cogsProductsTable).where(and(
    eq(cogsProductsTable.id, req.params.id), eq(cogsProductsTable.ownerId, userId),
  )).limit(1);
  if (!existing) { res.status(404).json({ error: "Товар не найден." }); return; }
  const [conflict] = await db.select({ id: cogsProductsTable.id }).from(cogsProductsTable).where(and(
    eq(cogsProductsTable.ownerId, userId), eq(cogsProductsTable.marketplace, parsed.marketplace),
    eq(cogsProductsTable.sellerSku, parsed.sellerSku),
  )).limit(1);
  if (conflict && conflict.id !== existing.id) { res.status(409).json({ error: "Такой артикул для выбранной площадки уже есть." }); return; }
  const [updated] = await db.transaction(async (tx) => {
    const [product] = await tx.update(cogsProductsTable).set({ ...parsed, updatedAt: new Date() })
      .where(and(eq(cogsProductsTable.id, existing.id), eq(cogsProductsTable.ownerId, userId))).returning();
    if (existing.unitCost !== parsed.unitCost) {
      await tx.insert(cogsCostHistoryTable).values({ ownerId: userId, productId: existing.id, unitCost: parsed.unitCost });
    }
    return [product];
  });
  res.json(updated);
});

router.delete("/cogs/:id", async (req, res): Promise<void> => {
  const deleted = await db.delete(cogsProductsTable).where(and(
    eq(cogsProductsTable.id, req.params.id), eq(cogsProductsTable.ownerId, ownerId(req)),
  )).returning({ id: cogsProductsTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Товар не найден." }); return; }
  res.sendStatus(204);
});

export default router;
