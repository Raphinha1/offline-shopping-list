FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN pnpm --filter @lista/api build \
    && pnpm --filter @lista/api deploy --legacy --prod /production/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /production/api/package.json ./package.json
COPY --from=build --chown=node:node /production/api/node_modules/ ./node_modules/
COPY --from=build --chown=node:node /production/api/dist/ ./dist/
COPY --from=build --chown=node:node /production/api/drizzle/ ./drizzle/
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
