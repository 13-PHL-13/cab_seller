FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @workspace/marketplace-cabinet build \
    && pnpm --filter @workspace/api-server build

ENV NODE_ENV=production

EXPOSE 10000

CMD ["sh", "-c", "pnpm --filter @workspace/db push && node lib/db/scripts/apply-company-workspaces.mjs && exec node --use-system-ca --enable-source-maps artifacts/api-server/dist/index.mjs"]
