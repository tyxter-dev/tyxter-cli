# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS base
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build
RUN mkdir -p /data && chmod 700 /data && chown 999:999 /data

FROM base AS production-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV TYXTER_CLI_STATE_DIR=/data
COPY --from=production-deps /repo/node_modules ./node_modules
COPY package.json ./
COPY --from=builder /repo/dist ./dist
COPY --from=builder --chown=999:999 /data /data
# Keep the uid/gid used by previous images so existing named volumes stay writable.
USER 999:999
VOLUME ["/data"]
ENTRYPOINT ["/nodejs/bin/node", "dist/main.js"]
CMD ["listen"]
