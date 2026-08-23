# The security settings this repository needs, and how to check them

Two of the four things below are files in this tree and are already done.
The other two are **repository settings**, which no pull request can change —
GitHub only takes them from a person with admin rights clicking in Settings.
This page says which is which, why each one matters here specifically, and how
to verify from a terminal rather than by looking at a page and believing it.

Run every check as someone with admin on the repository; several of these
endpoints answer "not found" rather than "not allowed" when your token is too
narrow, which reads exactly like "switched off".

---

## 1. Dependabot version updates — done, in the tree

`.github/dependabot.yml`. Weekly, grouped, majors left alone. Its own header
explains the grouping, and the distinction that matters: **security updates
ignore that file entirely.** When a package we depend on has a published
advisory, Dependabot opens a PR for it immediately regardless of the schedule
— _provided alerts are switched on_, which is item 3.

Verify:

```sh
gh api repos/vrtmis-ai/vgen/contents/.github/dependabot.yml --jq .name
```

## 2. CodeQL static analysis — done, and running

`.github/workflows/codeql.yml`, on every pull request and weekly. It is
deliberately **not** a required check: an advisory finding never blocks a merge,
because being unable to merge until each first-run false positive is dismissed
is how a scanner gets switched off in week two.

Verify it is not merely present but actually ingesting:

```sh
gh api repos/vrtmis-ai/vgen/code-scanning/alerts --jq 'length'
```

A number means the workflow's results are reaching the Security tab. An error
means they are not, and the workflow's `security-events: write` permission is
the first thing to look at.

## 3. Dependabot alerts — **OFF, and this is the one that matters**

```sh
gh api repos/vrtmis-ai/vgen/dependabot/alerts --jq 'length'
# Dependabot alerts are disabled for this repository.   ← today's answer
```

Without this, item 1 is a scheduler for routine version bumps and nothing else.
The advisory-driven PRs — the ones that exist because somebody published a CVE
against a package we ship — cannot open at all, because the alert that triggers
them is never raised. A public repository with roughly 1,200 transitive
packages that will take payments should not be finding out about those from a
stranger.

**Settings → Code security → Dependabot alerts → Enable**, and
**Dependabot security updates → Enable** directly beneath it. The second is
what turns an alert into a pull request rather than a notification somebody has
to act on by hand.

Expect a batch of alerts within minutes of enabling — that is the backlog
becoming visible, not a new problem.

Verify: the command above returns a number.

## 4. Secret scanning and push protection — status unknown, worth confirming

```sh
gh api repos/vrtmis-ai/vgen/secret-scanning/alerts --jq 'length'
```

This repository is public, so scanning for partner patterns is free and on by
default; **push protection** is the separate half, and it is the half worth
having. It refuses a push that contains something shaped like a credential
instead of telling you afterwards, which is the difference between a mistake
and an incident — a pushed key is public the moment it lands, and rotating it
is the only real remedy.

Relevant here because `.env.local` is gitignored and holds real provider keys
once someone fills it in, and because `provider_credentials.secret_ref` stores
environment-variable _names_ precisely so a database dump can never be a leaked
provider account. Push protection is the same idea one layer out.

**Settings → Code security → Secret scanning → push protection → Enable.**

---

## What none of this covers

Both scanners look at code and dependencies. Neither looks at the two things
most likely to actually hurt this product: a provider key committed by accident
before push protection was on (rotate it; the history is public), and an admin
account without a second factor. `v_admins_without_mfa` is the check for the
second, and `POST /admin/session` already refuses an account that appears in it.
