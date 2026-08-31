# ---------------------------------------------------------------------------
#  One image for the API, the worker, and the one-shot migrate/seed jobs.
#
#  All of them run the same TypeScript through the same loader, share the same
#  four workspace packages, and differ only in which entry point the container
#  is told to run. Three near-identical Dockerfiles would be three places to
#  forget the same change, so this is one image and the command is left to
#  docker-compose.prod.yml.
#
#  There is no compile step on purpose. `tsx` transpiles on load, which is how
#  `pnpm --filter @vgen/api start` already works locally, and adding a build
#  would create a second way for the running code to differ from the source.
#  It costs a second of startup, once, per deploy.
#
#  Debian slim rather than Alpine: nothing here needs a native module today,
#  but `sharp` is one `pnpm install` away in this workspace and musl builds of
#  it are the classic way an image works on a laptop and not on a server.
# ---------------------------------------------------------------------------
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
#  Dependencies, in their own layer.
#
#  Only the manifests are copied first, so editing a source file does not
#  reinstall node_modules — which matters when the VPS is doing the building
#  over a slow link. Dev dependencies are installed rather than pruned: `tsx`
#  is one of them, and it is the thing that runs in production.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/adapters/package.json packages/adapters/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/ ./
COPY . .
USER node

# `node --import tsx/esm` rather than `pnpm start`, and this is not cosmetic.
# Both processes install SIGTERM handlers that drain the queue and close the
# pool — the worker's is what stops a deploy killing a generation with the
# customer's coins still held. Every layer between PID 1 and that handler is a
# layer that can swallow the signal, and `pnpm run` -> `tsx` -> node is two.
# This is one exec: the process holding the handler is the process Docker
# signals. `init: true` in compose supplies the reaper that PID 1 would owe.
CMD ["node", "--import", "tsx/esm", "apps/api/src/server.ts"]
