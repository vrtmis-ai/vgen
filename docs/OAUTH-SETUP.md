# Registering the Google and Microsoft sign-in apps

The buttons exist, the routes exist, the token exchange is written and tested.
What does not exist is a registered application at either provider, so
`GOOGLE_CLIENT_ID` and friends have never had a real value to hold. This is the
once-per-organisation job of creating those two applications and handing the
four secrets around.

It is deliberately not urgent. **Neither provider is reachable from Iran
without a VPN**, which is why these are secondary buttons on the sign-in screen
rather than the primary path — the phone-and-code flow is the one that works
for the people this product sells to. These exist for everyone else.

## What the code already does

`apps/api/src/server.ts` builds each provider only when **both** halves are
present, and `GET /api/v1/session` reports which ones it built:

```jsonc
{ "status": "anonymous", "host": "web", "authProviders": ["google", "microsoft"] }
```

The sign-in screen renders a button for each name in that array and no others.
So a missing or misspelled variable is not an error anywhere — it is a button
that silently does not appear, which is the failure mode to recognise.

The callback URL is derived, not configured separately:

```
${API_PUBLIC_URL}/api/v1/auth/{google,microsoft}/callback
```

`API_PUBLIC_URL` defaults to `http://127.0.0.1:${API_PORT}` outside production,
so locally that is:

```
http://127.0.0.1:5181/api/v1/auth/google/callback
http://127.0.0.1:5181/api/v1/auth/microsoft/callback
```

Both providers match the redirect URI **exactly** — scheme, host, port, path,
no trailing slash. `localhost` and `127.0.0.1` are different strings to them
even though they resolve to the same machine, and picking the wrong one is the
single most common way this fails.

## Google

1. Google Cloud Console → **APIs & Services → OAuth consent screen**. User type
   **External**. Scopes: `openid`, `email`, `profile` — nothing else. The code
   asks for exactly those three and nothing here needs more.
2. While the app is in **Testing**, only accounts listed as test users can sign
   in at all. That is usually what you want first; publishing triggers Google's
   verification review, which is not worth starting until the domain is final.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   Add both callback URLs above under _Authorized redirect URIs_ — the local one
   and the deployed one — as separate entries on the same client, or make a
   second client for production.
4. Copy the client ID and client secret into `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.

## Microsoft

1. Microsoft Entra admin center → **App registrations → New registration**.
2. **Supported account types: "Accounts in any organizational directory and
   personal Microsoft accounts."** This is not a convenience choice. It
   corresponds to the `common` tenant the code defaults to, and `common` is the
   configuration under which Microsoft omits unverified addresses from the
   token — which is the only reason an email from this provider can be trusted
   to link an account at all. Read the comment above `tenant` in `server.ts`
   before narrowing it to a single tenant.
3. Redirect URI, platform **Web**, the microsoft callback above.
4. **Certificates & secrets → New client secret.** The value is shown once and
   never again; copy it immediately. It also **expires** — 24 months at most,
   and the sign-in button simply stops working on that day with a provider-side
   error nobody here will have logged. Put the expiry in a calendar now.
5. Copy the Application (client) ID and the secret value into
   `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`. Leave `MICROSOFT_TENANT`
   unset unless you deliberately chose a single tenant in step 2.

## Where the values go

`.env.local`, which is gitignored and stays that way. The four names are
already in `.env.example` as blanks.

**Never with a `NEXT_PUBLIC_` prefix.** That prefix means "inline this into the
browser bundle", this repository is public, and a client secret that reaches
either is a secret you now have to rotate at the provider.

## Checking it worked

```sh
curl -s http://127.0.0.1:5181/api/v1/session | jq .authProviders
# ["google","microsoft"]
```

If a name is missing, one of its two variables is empty or misspelled, or the
API was started before you edited the file — nothing watches `.env.local`, so
restart it. Then open the sign-in screen: a button for each name, and clicking
one should reach the provider's own consent page rather than an error. Coming
back to `/?auth=failed` means the exchange ran and was refused — a redirect URI
that does not match to the character is the first thing to check.
