# eNamad (اینماد) compliance — handoff

Status: research + codebase audit done 2026-09-09. **The three code work
items (§4, §5, §6) are built** — see "What is built" below. Everything in §3
and §9 remains the owner's and is untouched.
Scope: what DEEV needs to pass eNamad review, and to survive as a
user-prompt-driven generation platform under Iranian law.

Caveat on sources: `enamad.ir` would not load during research (TLS handshake
failed on every attempt). Everything below comes from Persian guides, ECDC
news coverage, and the repo itself. **Re-confirm fees and the current
checklist in the eNamad panel before acting on the numbers.**

---

## 1. Why this blocks revenue

Shaparak requires both an eNamad seal and a tax tracking code
(کد رهگیری مالیاتی) before any bank issues an internet payment gateway.
No seal, no gateway, no revenue. That is the whole reason this matters.

The seal itself is cheap and fast. The blocker is the prerequisites, which
are mostly paperwork the owner does, not code.

## 2. Pick a tier first

| Tier              | Review                   | Issuance  | Limit                         |
| ----------------- | ------------------------ | --------- | ----------------------------- |
| اینماد بدون ستاره | identity + domain only   | minutes   | ~100 txns or 100M تومان/month |
| اینماد ستاره‌دار  | full evaluator checklist | 7–10 days | none                          |

The starless tier is the fast path to a working gateway. It is a real
ceiling though, so if DEEV expects to clear 100M تومان/month, plan for the
starred review from the start. The site requirements in §4 are the same work
either way and you do not want to do them twice.

| Cost               | Amount        |
| ------------------ | ------------- |
| بدون ستاره, year 1 | 50,000 تومان  |
| بدون ستاره, year 2 | 125,000 تومان |
| ستاره‌دار, 2 years | 175,000 تومان |

## 3. Owner prerequisites — NOT agent work

Do not try to solve these in code. Flag them to the owner and wait.

- **Tax tracking code** from an income tax file. Hard dependency for the gateway.
- **A mobile number registered in the owner's own name.** Checked against شاهکار. A number in a relative's name fails.
- **Identity data matching ثبت احوال exactly.** Most common rejection cause.
- **A landline** at the business address. Verified by callback.
- **Public WHOIS** on the domain.
- **Email on the DEEV domain.** Gmail, Yahoo and Outlook are rejected outright.
- **Documents as JPG under 200KB.** حقیقی: national card plus first page of شناسنامه (mandatory). حقوقی: اساسنامه, establishment notice and latest changes in روزنامه رسمی, board resolution naming the signatory, plus CEO identity documents.
- **Sector permit.** For an IT or software service, a نظام صنفی رایانه‌ای (نصر) permit is the relevant one and is accepted for eNamad.
- **A test account** (username and password) handed to the evaluator so they can walk the full purchase and generation flow themselves. This is why §5 matters.

Separately: **ساماندهی** (samandehi.ir, وزارت ارشاد) is a different seal, it
is free, and registration applies to content sites. Worth filing. It is not a
gateway blocker.

## 4. Code work item A — the legal pages

Current state: `app/cookies/page.tsx` is the **only** legal page in the repo.
A full-repo grep found no terms, privacy, refund, about, or contact page.

Five pages needed. Follow the existing `app/cookies/page.tsx` pattern rather
than inventing a new layout.

1. **قوانین و مقررات** — terms of use. Must state what DEEV sells (generation credits) and what a user may not generate. This page is where the content policy lives.
2. **حریم خصوصی** — must cover prompts, uploaded reference images, and generated outputs. DEEV stores all three. Say so.
3. **درباره ما** — the real owner's identity, not just the brand. Evaluators check this against the registration documents.
4. **تماس با ما** — postal address, landline, mobile, domain email.
5. **Sales, delivery and refund terms** — for a credits product this means: what happens when a generation fails, whether credits are returned, whether unused credits are refundable, and how long credits live. This maps to the sales-transparency category and is the one people skip.

Also required across the whole site: **Persian on every page**, and HTTPS.

Content is the owner's to write. The agent should scaffold structure and
headings, not invent legal terms.

## 5. Code work item B — the prompt guard (the real gap)

`apps/api/src/routes/jobs.ts` has exactly one guard, an account-level ban
check at line 30. **Nothing inspects the prompt before it is dispatched to
the provider.**

Why this matters more than the seal: DEEV is a platform where users type
arbitrary prompts and get images and video back. Under قانون جرایم رایانه‌ای
that makes DEEV a content platform. The کارگروه تعیین مصادیق محتوای مجرمانه
can order the host to block the site whether or not it holds eNamad.

And immediately: the eNamad evaluator will be logged into a real account
walking the generation flow. An unfiltered generator is a rejection.

Minimum viable guard:

- One blocklist, checked in `jobs.ts` before dispatch, rejecting with a clear message.
- Put it in the shared job path, not per provider. Every generation route already funnels through there, so one guard covers all of them.
- Record the rejection. A refusal you cannot show is a refusal you cannot prove.

**The list itself is a judgment call for the owner or a lawyer**, aligned to
the published مصادیق محتوای مجرمانه. The agent should build the mechanism and
leave the list configurable, not guess at the contents.

Also needed: **terms acceptance at signup**, recorded with a timestamp. The
undertaking (تعهدنامه) the owner signs to eNamad should be backed by one the
user signed to DEEV.

## 6. Code work item C — takedown endpoint (verified gap)

The explore moderation flow is already good (see §7). But:

- `posts.deleted_at` exists and `packages/db/src/communityRepository.ts` respects it in every read.
- **No route sets it.** `decide()` in `apps/api/src/routes/adminCommunity.ts` only matches `status = 'pending'`.

So an already-approved post cannot be pulled down through any API. When a
takedown order arrives there is no way to comply short of a manual SQL
update. Add an admin route that soft-deletes an approved post, audited the
same way approve and reject already are.

There is also **no report mechanism** anywhere. A report control on feed
items, writing into the existing moderation queue, is the cheap version.

## 7. Already done — do NOT rebuild

The explore page is in better shape than the rest. Verified in the code:

- Shares land `pending`. Nothing self-publishes.
- `GET` and `POST /api/v1/admin/community/pending` give admins an approve and reject queue.
- Both decisions are written to `audit_log`.
- Consent to publish is explicit, and consent to publish _the prompt_ is a separate flag.
- The feed serves approved, non-deleted posts only.
- Account bans exist and are enforced in `jobs.ts`.

Output-side moderation for anything public is therefore already human-gated.
The exposure is the **private** path: prompt to provider to the user's own
gallery, which no human ever reviews. That is what §5 covers.

## What is built

Migrations `0029_compliance_and_staff.sql` and `0030_post_reports.sql`.

**§4 — the five pages.** `/terms`, `/privacy`, `/coins`, `/about`, `/contact`,
all Persian, all reachable from the landing footer, sharing one shell
(`src/components/LegalPage.tsx`). The footer already pointed at `/terms`,
`/privacy` and `/coins` and **all three were 404s** — which is what a reviewer
clicks first. Facts the code can vouch for are written out; every business fact
is a visible `⚠` marker rather than an invented value, because a plausible
wrong address is checked against the registration documents and fails the
review it was meant to pass. Search the five pages for `Blank` to find them all.

**§5 — the prompt guard.** `apps/api/src/promptGuard.ts`, in front of **both**
surfaces that carry a prompt: the quote (so nobody is priced for what will not
be built) and the job (the one that dispatches, and the one a client cannot
skip). Reads the prompt out of `params`, which is what the worker hands upstream
verbatim. Refuses with **422 `prompt_refused`**, never naming the phrase that
matched. Every refusal is recorded; a failure to record it does not rescue the
request. Matching folds Persian first — ک/ك, ی/ي/ى, ZWNJ, tatweel, harakat and
three sets of digits — so the same word typed on another keyboard is the same
word. Substrings only, never regex: a pattern typed into an admin field runs
against every prompt on the platform.

**The list ships empty and the guard is a no-op until somebody fills it.** That
is item 3 of §9 and it is still open.

**§5 — terms acceptance.** `users.terms_accepted_at` / `terms_version`, written
by the one insert every signup path funnels through, so password, phone-code and
each OAuth provider are covered and a route added next year cannot forget.
Signing in again does not restate an agreement.

**§6 — takedown.** `DELETE /api/v1/admin/community/posts/:id`, audited as
`community.post.takedown`, reason required. `posts.deleted_at` had existed since
0001 and **nothing set it**.

**§6 — reports.** `POST /api/v1/community/posts/:id/report` and a flag control
on each feed card, with an admin queue at `GET /admin/community/reports`. A
report hides nothing on its own — one that un-published would be a veto anyone
could exercise with a click. One per person per post.

Also built, from the same session but not from this document: tiered staff
permissions (`user_roles.permissions`) and staff plan grants. See `docs/API.md`.

### Still open

- The blocklist contents (§9 item 3). The mechanism is live and refuses nothing.
- Every `⚠` marker on the five pages.
- Everything in §3 — the paperwork.
- HTTPS and the eNamad script tag, which are deployment rather than code.

## 8. Pre-submission checklist

Before handing the evaluator a test account, confirm:

- [x] All five pages of §4 exist, in Persian, reachable from the footer
- [ ] Every `⚠` on those five pages replaced with a real value
- [ ] HTTPS enforced, no mixed content
- [x] Prompt guard live and returning a clear refusal
- [ ] `prompt_rules` actually contains a list
- [x] Terms acceptance recorded at signup
- [x] Takedown route exists and is audited
- [x] A way for somebody to report a published post
- [ ] Contact details on the site match the registration documents exactly
- [ ] eNamad code pasted as the official linked script, never a flat image. Fake or unlinked marks are explicitly forbidden.

## 9. Open questions for the owner

1. حقیقی or حقوقی registration? Changes the whole document set.
2. Starless or starred tier? Depends on expected monthly volume.
3. Who writes the blocklist contents?
4. What is the actual refund policy for unused credits and failed generations? This has to be decided before page 5 can be written.

## Sources

- https://www.zarinpal.com/blog/اینماد-چیست/
- https://daftareshoma.com/blog/اینماد-enamad/
- https://blog.paystar.ir/guide-to-getting-enamad-ir/
- https://www.zoomit.ir/howto/178304-how-to-register-for-enamad/
- https://7learn.com/blog/what-is-enamad
- https://www.cyberpolice.ir/page/2551
- https://www.netafraz.com/blog/samandehi-license-for-website/
- https://www.shahrsakhtafzar.com/fa/news/35395-enamad-zero-star-certificate
