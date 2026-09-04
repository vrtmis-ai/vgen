# Deploying to a VPS

Everything runs on one host under Docker Compose: Postgres, Redis, MinIO, the
Fastify API, the generation worker, the Next.js front end, and Caddy in front of
all of it. Caddy is the only container with a published port.

```
                    :80 :443
                       │
                    ┌──▼───┐
   deev.ir ────────►│      │──► web    :5180   Next.js, standalone
   deev.ir/api/* ──►│ caddy│──► api    :5181   Fastify
   files.deev.ir ──►│      │──► minio  :9000   read-only from outside
                    └──────┘
                       │        worker         no port, polls the queue
                       │
              postgres · redis · minio         internal network only
```

The database that holds the credit ledger is not a port on a public IP. Nothing
below changes that.

---

## Before you start

**A VPS** with 4 GB of RAM and Docker Engine with the Compose plugin. 4 GB is
enough to run it; the web image build is the heaviest moment, so if the build
gets killed, build it somewhere else and push the image rather than buying more
machine. Disk grows with generated video — MinIO holds every output forever.

**Two DNS records**, both A records pointing at the VPS:

```
deev.ir           →  <your ip>
files.deev.ir     →  <your ip>
```

The second one is not optional and not cosmetic. See _Why the object store has
its own hostname_ below.

**A note for Iranian hosts.** Docker Hub is frequently unreachable from Iranian
IPs. If `docker pull` hangs or 403s, set a registry mirror in
`/etc/docker/daemon.json` and restart the daemon — that is a host configuration
issue rather than anything about this repo, but it is the first thing that will
stop you.

---

## 1 · Configure

```bash
git clone <repo> vgen && cd vgen
cp .env.production.example .env.production
```

Generate every secret in one go and paste them in:

```bash
for name in POSTGRES_PASSWORD RATE_LIMIT_HASH_SECRET PHONE_HASH_PEPPER \
            MFA_SEALING_KEY OBJECT_STORAGE_SECRET_KEY; do
  printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
done
printf 'OBJECT_STORAGE_ACCESS_KEY=%s\n' "$(openssl rand -hex 16)"
```

Then read `.env.production` top to bottom. It explains each value where it sits,
but four are worth knowing before you fill them in:

- **`DATABASE_URL` must carry the same password as `POSTGRES_PASSWORD`.** Out of
  step, it presents as `password authentication failed for user vgen`, which
  reads like a permissions problem rather than a typo.
- **`PHONE_HASH_PEPPER` and `MFA_SEALING_KEY` can never be changed.** The first
  re-opens the free trial for every number that ever signed up; the second
  invalidates every staff TOTP enrolment, including the one that grants credits.
  Back both up somewhere that is not this server, before the first boot.
- **`NEXT_PUBLIC_API_BASE_URL` is compiled into the browser bundle**, not read
  at boot. Changing it later means `docker compose build web`; restarting picks
  up nothing. The build fails loudly if it is empty, which is deliberate — the
  alternative is an image that shows every visitor "services are not
  configured".
- **`TRUST_PROXY` is the compose subnet**, `172.28.0.0/16`, which is pinned in
  `docker-compose.prod.yml` precisely so this value can be written down. Never
  `true`: that lets any client forge `X-Forwarded-For` and walk around the rate
  limiter. Behind a CDN as well, append its published ranges too, or every
  visitor shares one bucket under the CDN's address.

Set `SITE_ADDRESS` and `FILES_ADDRESS` with an explicit scheme. `https://` means
Caddy gets its own certificate; `http://` means TLS is terminated in front of it
by a CDN or a load balancer. A bare hostname means https, which behind a CDN is
a redirect loop rather than an error.

---

## 2 · Bring it up

The env file is named twice on every command — once for compose's own `${...}`
substitutions and once, inside the file, for what the containers receive. It is
worth an alias:

```bash
alias dc='docker compose --env-file .env.production -f docker-compose.prod.yml'
```

```bash
dc build                      # the web build is the slow one
dc run --rm migrate           # schema
dc run --rm seed              # catalogue, pricing, plans, grants, providers, content
dc up -d
```

**The order matters, and not only on the first deploy.** `dc run --rm migrate`
starts Postgres by itself, so nothing else is running yet. Reverse it — `up -d`
first — and the worker polls a database without an `outbox` table twice a second
until the migration lands, logging a failure each time; the API is equally happy
to answer requests against a schema that is not there. Neither breaks anything
permanently, and neither is a state worth being in.

`migrate` and `seed` sit behind a compose profile, so they never start with
`up`. Both are safe to re-run — CI asserts that seeding twice writes nothing the
second time, which is also how you publish a catalogue or pricing change later.

Then create the staff account, which is the only way into `/admin`:

```bash
dc run --rm seed pnpm admin:create you@example.com 'a-long-password'
```

It prints an `otpauth://` URI once. Add it to an authenticator app **before you
close the terminal** — the secret is sealed into the database and this is the
only moment it is readable. `POST /admin/session` refuses an account with no
second factor, so losing it means running this again.

---

## 3 · Verify

```bash
curl -s https://deev.ir/health/ready
```

`{"status":"ready", ...}` with every dependency `up`. `degraded` names the one
that is not, which is faster than reading logs.

Then in a browser: the site at `https://deev.ir`, sign-in, and `/admin` with the
account above. If the app renders but says services are not configured, the web
image was built with an empty `NEXT_PUBLIC_API_BASE_URL` — rebuild it, do not
look at the API.

---

## 4 · Turning generation on

**This is the part that waits on money, and nothing above does.** The stack runs
fine without it: people can sign up, browse, and be quoted a price. A submitted
generation will fail `provider_unavailable` and refund in full.

When a provider account has credit, two things switch it on:

1. **Put the key in `.env.production`** — `KIE_API_KEY` — then
   `dc up -d api worker`. KIE first: its adapter is the only one a spike proved
   by spending real credits. WaveSpeed's submit path and all three of its
   failure modes are known; its success path has never run.
2. **Grant coins** in `/admin`, or `POST /api/v1/admin/users/:id/credits`.
   Payments are not wired to a gateway, so this is how a balance exists at all
   today.

**You do not need to activate a route.** `jobRunnerRepository.claim` picks the
serving row from an unlimited grant first, then an active `model_routes` row,
and otherwise the catalogue row runs itself — which is the common case and
covers all 45 variants, video included. The four seeded routes are WaveSpeed
_alternates_ and ship inactive so nothing silently moves off the default; you
activate one only to move a model deliberately.

Verified rather than assumed: a job submitted with every route inactive reached
KIE and failed with `KIE_API_KEY is not set`.

### What has never run

Everything up to the provider call is exercised, including on this deployment —
quote, tier gate, price refusal, hold, submit, outbox, queue, worker, provider
lookup, clean failure, released hold, ledger entry. Past that point, three
things will happen for the first time with real credit:

- **The provider call from the worker.** `scripts/spike-kie.ts` proved the
  adapter's request shape and error envelope by spending real credits, so this
  is the least uncertain of the three.
- **Output mirroring.** The worker downloads the finished file into our own
  store before the job counts as done, because the provider's URL expires. It is
  also the one step that cannot be retried by re-running the job — that would
  generate a second picture and pay twice — so a failure here fails the job and
  refunds, and we eat the provider's charge.
- **Capture.** Every settlement so far has released a hold. Charging one is
  covered by integration tests and has never happened against a real generation.

Watch `dc logs -f worker` for the first one. Video is the case to watch: the
poll budget is ten minutes at two-second intervals, which is comfortable for
images and not obviously enough for a long clip at high resolution. A job that
exceeds it fails `provider_timeout` and refunds, so the cost of finding out is
time rather than money.

---

## Why the object store has its own hostname

Two readers of a signed URL are not on this network, and neither is obvious:

- **the browser**, which is handed one for every gallery item, and
- **the generation provider**, which is handed one for every reference image and
  fetches it from its own servers.

So the host inside a signed URL must be publicly resolvable. Point it at
`minio:9000` and reference-based generation fails everywhere, with an error that
looks like the provider misbehaving.

That is why there are two variables. `OBJECT_STORAGE_ENDPOINT` is how the API
and worker connect — private, never published. `OBJECT_STORAGE_PUBLIC_ENDPOINT`
is the name that goes into signatures. Presigning is arithmetic and contacts
nothing, so the split costs nothing and keeps uploads off the public interface.

A hostname rather than a path under the site, because an S3 signature covers the
whole path: served at `/files/*`, stripping the prefix invalidates every
signature and keeping it makes MinIO look for a bucket called `files`.

Caddy answers `GET`, `HEAD` and `OPTIONS` on that hostname and `405`s everything
else. Nothing legitimate writes through it — the API and worker write over the
internal network, and the browser posts uploads to the API rather than holding a
presigned `PUT` — so a leaked storage credential still cannot write from
outside.

---

## Updating

```bash
git pull
dc build
dc run --rm migrate      # only if the pull added a migration
dc up -d
```

The worker gets 60 seconds to finish the attempt it is on. A generation in
flight is a customer's held coins, and both processes handle `SIGTERM` — which
is why the containers run under Docker's init and exec `node` directly instead
of going through `pnpm`, so the signal reaches the handler rather than a shell.

---

## Backups

Nothing here backs anything up. Two volumes matter and they are not equal:

- **`vgen-prod_postgres-data`** — accounts, the credit ledger, every job. Losing it
  is losing the business.
- **`vgen-prod_minio-data`** — every generation anyone has made. Losing it is losing
  what customers paid for.

The database dump is the small one and should be on a schedule:

```bash
dc exec -T postgres pg_dump -U vgen vgen | gzip > "vgen-$(date +%F).sql.gz"
```

Keep it off this host. Keep `PHONE_HASH_PEPPER` and `MFA_SEALING_KEY` with it —
a dump restored without them is a database whose staff cannot sign in and whose
free trials have all reset.

---

## Traps

Each of these has a symptom that points somewhere else.

**"The published content did not load", or the app renders unstyled.** The web
image was built without `NEXT_PUBLIC_API_BASE_URL`, or `.next/static` and
`public/` did not make it in. Both are baked at build time; restarting the
container changes nothing.

**Every visitor shares one rate-limit bucket.** `TRUST_PROXY` is unset or wrong,
so Fastify reports the proxy's address as the client's. Symptom is sporadic
429s under mild traffic.

**Sign-in does nothing.** `KAVENEGAR_API_KEY` and `KAVENEGAR_TEMPLATE` are
required — the API refuses to start in production without a real SMS gateway
rather than printing customers' codes into the logs. Google and Microsoft are
configured independently and neither is reliably reachable from Iran, so phone
OTP is the route that has to work.

**Reference images fail while plain prompts succeed.**
`OBJECT_STORAGE_PUBLIC_ENDPOINT` is unset or private. The provider cannot fetch
what it was handed.

**Certificates re-issue on every restart.** The `vgen-prod_caddy-data` volume was
lost. Let's Encrypt rate-limits that to five per week per hostname.

**`web` restart-loops with `MODULE_NOT_FOUND … @swc/helpers`.** Next's
standalone tracer under-copies that package — `cjs/` but not the `esm/` build
its own require-hook asks for. `next.config.ts` names it in
`outputFileTracingIncludes`; removing that line reproduces it. You should never
meet this one, because the web image boots itself and fetches a page as its last
build step and fails the build instead. See `docs/KNOWN-FLAKES.md` for the two
diagnoses that look right and are not.

---

## Not built yet

Deploying does not change any of these; they are listed so a gap is not mistaken
for a broken deploy.

- **Payments.** Plans price correctly and nothing charges — blocked on which
  Iranian gateway. Credits are granted from `/admin` meanwhile.
- **useapi / PixVerse**, so unlimited-tier generation quotes free and then fails
  and refunds. No token has ever exercised their API.
- **Catalogue art still hotlinks the supplier's CDN** — family covers and voice
  previews. No JSON names the supplier; the network tab does.
- **No backfill of file measurements.** New generations record their own width,
  height and duration; rows written before that landed stay null, because the
  provider's copy they came from is long gone.
- **No CI deploy.** The workflow runs checks and stops; deploying is the manual
  sequence above.
