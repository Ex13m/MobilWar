FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile --filter @mobilwar/server... 
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @mobilwar/server build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/mobilwar.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/packages/shared/package.json ./packages/shared/
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "apps/server/dist/apps/server/src/index.js"]
