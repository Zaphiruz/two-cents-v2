# ---- build ----
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @two-cents/api prisma:generate
RUN pnpm --filter @two-cents/api build

# ---- runtime ----
# Preserve the /repo workspace layout so pnpm's symlinked node_modules resolve
# (apps/api/node_modules/prisma → ../../../node_modules/.pnpm/...).
FROM node:22-alpine AS app
WORKDIR /repo/apps/api
RUN apk add --no-cache openssl
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/
COPY --from=build /repo/packages/shared /repo/packages/shared
COPY --from=build /repo/apps/api /repo/apps/api
EXPOSE 4000
# Default to api; worker overrides CMD in compose.
CMD ["node", "entrypoint.mjs", "dist/server.js"]
