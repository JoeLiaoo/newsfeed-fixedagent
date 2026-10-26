# syntax=docker/dockerfile:1
# One image for every role: setup (migrations and seed), api, worker and web.
# Build arg NPM_REGISTRY switches the npm registry (e.g. https://registry.npmmirror.com in mainland China).
FROM node:24-trixie-slim AS base
WORKDIR /app
# pg_dump for the optional database backups (Debian's client matches the PostgreSQL 17 server in compose).
# The fonts are for the page renderer: a page of a PDF is drawn as a picture, and without any font
# on the machine the letters of that page are not drawn at all (the vector drawings still are).
# fontconfig finds them, Liberation covers the standard PDF fonts and WenQuanYi the Chinese ones.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client ca-certificates fontconfig fonts-liberation fonts-wqy-microhei \
 && rm -rf /var/lib/apt/lists/*

FROM base AS build
ARG NPM_REGISTRY=
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/backend/package.json packages/backend/
COPY packages/contracts/package.json packages/contracts/
COPY industry/package.json industry/
COPY modules/membership/package.json modules/membership/
COPY site/package.json site/
RUN --mount=type=secret,id=proxy_ca,target=/run/secrets/proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --no-audit --no-fund ${NPM_REGISTRY:+--registry=$NPM_REGISTRY}; \
    else npm ci --no-audit --no-fund ${NPM_REGISTRY:+--registry=$NPM_REGISTRY}; fi
COPY . .
RUN npm run build -w @aihot/web && npm prune --omit=dev --no-audit --no-fund

FROM base
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.ts"]
