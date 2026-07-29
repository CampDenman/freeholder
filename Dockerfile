# Copyright (C) 2026 Camp Denman Society
# SPDX-License-Identifier: AGPL-3.0-only
# One image, every target (§18: no target-specific forks of application logic).
#
# Three stages so the thing that ships carries neither the package manager nor
# the build toolchain: deps installs, build compiles, runtime holds the
# standalone output and nothing else.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
# --frozen-lockfile: an image that quietly resolves different versions than CI
# tested is not the artifact anybody reviewed.
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
# The build must not need secrets: env.ts validates lazily so `next build`
# succeeds with no database attached (§14).
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Never root: a web process that is compromised should not also own the disk.
RUN groupadd --system --gid 1001 freeholder \
 && useradd --system --uid 1001 --gid freeholder freeholder
COPY --from=build --chown=freeholder:freeholder /app/.next/standalone ./
COPY --from=build --chown=freeholder:freeholder /app/.next/static ./.next/static
COPY --from=build --chown=freeholder:freeholder /app/public ./public
# Migrations travel with the image so a release can never be newer than the
# schema it expects.
COPY --from=build --chown=freeholder:freeholder /app/db ./db
USER freeholder
EXPOSE 3000
CMD ["node", "server.js"]
