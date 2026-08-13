# DEEV

## Local development

The default `.env.development` uses deterministic demo services. Run only the web UI with:

```sh
pnpm dev
```

For the real local stack (PostgreSQL, Redis, MinIO, migrations, API, and web), keep Docker Desktop running and use:

```sh
pnpm dev:stack
```

## Clerk authentication

DEEV uses Clerk for browser sessions and keeps a separate PostgreSQL UUID for wallet, billing, and generation ownership.

1. Create a Clerk application.
2. In **User & authentication**, require an email address, enable **Email verification code** for sign-up and sign-in, disable password and phone strategies, and enable Google/Microsoft OAuth.
3. Enable strict user-enumeration protection.
4. Copy `.env.example` to `.env.development.local` (it is ignored by Git) and set:
   - `VITE_APP_MODE=production`
   - `VITE_AUTH_PROVIDER=clerk`
   - `VITE_API_BASE_URL=http://127.0.0.1:5181/api/v1`
   - `VITE_CLERK_PUBLISHABLE_KEY`
   - `CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `DATABASE_URL`
   - `REDIS_URL`
   - `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`
5. Start the local stack:

```sh
pnpm dev:stack
```

Never expose `CLERK_SECRET_KEY` through a `VITE_` variable.
