# syntax=docker/dockerfile:1.7

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
ENV TYXTER_LISTENER_STATE_DIR=/data
RUN useradd --system --create-home --shell /usr/sbin/nologin app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder --chown=app:app /repo/dist ./dist
RUN mkdir -p /data && chown app:app /data
USER app
VOLUME ["/data"]
ENTRYPOINT ["node", "dist/main.js"]
CMD ["listen"]
