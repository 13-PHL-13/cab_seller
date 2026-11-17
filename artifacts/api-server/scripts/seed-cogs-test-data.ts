import { and, eq } from "drizzle-orm";
import { db, pool, cogsCostHistoryTable, cogsProductsTable, usersTable } from "@workspace/db";

const email = process.env.TEST_USER_EMAIL?.trim().toLowerCase();
if (!email) {
  throw new Error("Укажите TEST_USER_EMAIL — email уже созданного тестового аккаунта.");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Заполнение тестовыми товарами запрещено при NODE_ENV=production.");
}
if (process.env.ALLOW_TEST_DATA_SEED !== "true") {
  throw new Error("Для подтверждения операции задайте ALLOW_TEST_DATA_SEED=true.");
}

const sampleProducts = [
  { sellerSku: "TEST-BATH-MAT-001", productName: "Коврик для ванной «Комфорт» — 50×80 см, микрофибра, серый", unitCost: "1200.00" },
  { sellerSku: "TEST-BATH-MAT-002", productName: "Коврик для ванной «Премиум» — 60×90 см, противоскользящий, бежевый", unitCost: "1500.00" },
  { sellerSku: "TEST-BATH-MAT-003", productName: "Коврик для ванной «Аква» — 45×75 см, быстросохнущий, синий", unitCost: "950.00" },
  { sellerSku: "TEST-BATH-MAT-004", productName: "Набор ковриков «Дуэт» — 2 шт., 50×80 и 40×50 см", unitCost: "2100.00" },
  { sellerSku: "TEST-BATH-MAT-005", productName: "Коврик для ванной «Мягкий» — 50×70 см, хлопок, белый", unitCost: "1350.00" },
] as const;

async function main() {
  const [user] = await db.select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) {
    throw new Error(`Аккаунт ${email} не найден. Сначала зарегистрируйте тестовый аккаунт.`);
  }

  let inserted = 0;
  let skipped = 0;
  for (const sample of sampleProducts) {
    const [existing] = await db.select({ id: cogsProductsTable.id })
      .from(cogsProductsTable)
      .where(and(
        eq(cogsProductsTable.ownerId, user.id),
        eq(cogsProductsTable.marketplace, "both"),
        eq(cogsProductsTable.sellerSku, sample.sellerSku),
      )).limit(1);

    if (existing) {
      skipped++;
      continue;
    }

    await db.transaction(async (tx) => {
      const [product] = await tx.insert(cogsProductsTable).values({
        ownerId: user.id,
        marketplace: "both",
        ...sample,
      }).returning({ id: cogsProductsTable.id });
      await tx.insert(cogsCostHistoryTable).values({
        ownerId: user.id,
        productId: product.id,
        unitCost: sample.unitCost,
      });
    });
    inserted++;
  }

  console.log(`Тестовый аккаунт: ${user.email}`);
  console.log(`Добавлено: ${inserted}; уже существовало и пропущено: ${skipped}; всего в наборе: ${sampleProducts.length}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
