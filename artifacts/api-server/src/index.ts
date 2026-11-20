import app from "./app";
import { logger } from "./lib/logger";
import { ensureCollaborationSchema } from './lib/collaboration-schema';
import { ensureCommerceSchema } from './routes/commerce';
import { ensureMarketplaceSyncSchema, startMarketplaceSync } from './lib/marketplace-sync';
import { syncHandlers } from './lib/sync-handlers';

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await ensureCollaborationSchema();
await ensureCommerceSchema();
await ensureMarketplaceSyncSchema();
const stopMarketplaceSync = startMarketplaceSync(syncHandlers);
process.once('SIGTERM', stopMarketplaceSync);

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
