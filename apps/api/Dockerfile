# syntax=docker/dockerfile:1
# Build context: repository root (npm workspaces share one lockfile)

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/api --include-workspace-root=false
COPY apps/api apps/api
RUN npx --workspace apps/api prisma generate && npm run build --workspace apps/api
RUN npm prune --omit=dev --workspace apps/api --include-workspace-root=false

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 STORAGE_LOCAL_DIR=/data/attachments
# Prisma's query engine links against OpenSSL 3
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/attachments && chown -R node:node /data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --chown=node:node apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
WORKDIR /app/apps/api
USER node
EXPOSE 4000
VOLUME ["/data/attachments"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run with an init process (compose sets `init: true`) so signals reach node for graceful shutdown
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
