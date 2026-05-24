# ---- build ----
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @two-cents/api prisma:generate
RUN pnpm --filter @two-cents/api build

# ---- runtime ----
FROM node:22-alpine AS app
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api/prisma ./prisma
COPY apps/api/entrypoint.mjs ./entrypoint.mjs
EXPOSE 4000
# Default to api; worker overrides CMD in compose.
CMD ["node", "entrypoint.mjs", "dist/server.js"]
