# Polling Station: one container, one SQLite file, one uploads folder (both under /data).
FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
# Build-time placeholders only; the real values come from the environment at run time.
ENV DATABASE_URL="file:/data/elections.db" NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build

FROM node:24-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads && chown -R node:node /data
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATABASE_URL="file:/data/elections.db" UPLOAD_DIR="/data/uploads" IPLIST_DIR="/data/iplists" MAILBOX_DIR="/data/mailbox" TRUST_PROXY="1"
COPY --from=build --chown=node:node /app ./
USER node
VOLUME /data
EXPOSE 3220
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3220/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p 3220"]
