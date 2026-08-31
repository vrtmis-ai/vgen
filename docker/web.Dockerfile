# ---------------------------------------------------------------------------
#  The Next.js front end, as a standalone server.
#
#  `output: "standalone"` in next.config.ts emits a self-contained bundle with
#  its own pruned node_modules, which is the whole reason this deploys to a VPS
#  without shipping the pnpm store.
#
#  One thing about that bundle is load-bearing and invisible: in a pnpm
#  workspace the symlinks Next writes into `standalone/node_modules` are
#  ABSOLUTE — `next` points at `<workdir>/node_modules/.pnpm/next@…`. They
#  resolve only because the standalone tree is copied back to the same path it
#  was built at, where its own `.pnpm` directory then sits under that name.
#  So the WORKDIR is /app in every stage below and the copy target is `./`.
#  Change either and the image builds cleanly, then exits on boot with
#  "Cannot find module 'next'".
# ---------------------------------------------------------------------------
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/adapters/package.json packages/adapters/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .

# ---------------------------------------------------------------------------
#  Where the API lives is compiled INTO this image, not read at boot.
#
#  Next substitutes `process.env.NEXT_PUBLIC_*` into the client bundle at build
#  time, so this is a build argument and not a compose environment entry.
#  Setting it in the container instead does nothing at all: the browser gets
#  whatever was inlined here, the app decides it is unconfigured, and every
#  visitor sees "DEEV production services are not configured" on a deployment
#  whose environment looks correct. Hence the guard — an empty value is a
#  broken image, and it should fail here rather than in front of a customer.
# ---------------------------------------------------------------------------
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_APP_RELEASE=""
ENV NEXT_PUBLIC_APP_MODE=production
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_APP_RELEASE=${NEXT_PUBLIC_APP_RELEASE}
RUN test -n "$NEXT_PUBLIC_API_BASE_URL" || { \
      echo "NEXT_PUBLIC_API_BASE_URL is baked into the bundle at build time and is empty."; \
      echo "Pass it: docker compose build --build-arg NEXT_PUBLIC_API_BASE_URL=https://your.domain/api/v1"; \
      exit 1; \
    }
# `pnpm exec next build`, not `pnpm build`: the package script also runs two
# tsc --noEmit passes over the scripts and e2e projects, neither of which ships
# in this image and both of which need dev-only type packages.
RUN pnpm exec next build

FROM base AS runtime
ENV NODE_ENV=production
# The standalone server reads both. Without HOSTNAME it binds loopback inside
# the container, where the proxy on the other side of the network cannot see it.
ENV PORT=5180
ENV HOSTNAME=0.0.0.0
# Neither of these is inside the standalone bundle — Next assumes whatever is
# serving the app also serves its assets from disk. Miss them and the app
# renders unstyled with every image broken, which reads like a CSS bug.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# ---------------------------------------------------------------------------
#  Boot the thing and ask it for a page, before calling this an image.
#
#  Nothing weaker is worth having. This bundle failed four builds running, and
#  the last attempt was caught by a guard that required the same module the
#  server does and passed — because the module loads fine, and it is a file
#  *inside* it that the tracer left out. Every proxy for "does it work" agreed
#  it worked. Only starting it disagreed.
#
#  It needs no database and no API: this stage is Next serving its own shell, so
#  a 200 here means the bundle is complete. Fifteen seconds, once per build, in
#  exchange for a class of failure that otherwise only appears in production and
#  reads like an application bug.
# ---------------------------------------------------------------------------
RUN node server.js & \
    pid=$!; ok=0; \
    for _ in $(seq 1 30); do \
      sleep 1; \
      if node -e "fetch('http://127.0.0.1:5180/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then ok=1; break; fi; \
    done; \
    kill $pid 2>/dev/null; \
    if [ "$ok" != 1 ]; then echo "the standalone bundle does not serve — see the server output above"; exit 1; fi; \
    echo "standalone bundle boots and serves"

USER node
EXPOSE 5180
CMD ["node", "server.js"]
