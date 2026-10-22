# Pre-launch audit, 2026-10-21

Coding agents ran this audit. It is not the independent review C11.10
requires, and it does not close C11.10. It records what was found, what was
repaired, how each repair was checked, and what remains open.

## Method

Four read-only reviews ran against `main` at `973382ea`: security
(authorization, CSRF, SSRF, injection, redirects, webhooks, rate limits),
correctness of the most recent merges (PRs #536–#547), the architecture rules
in `CLAUDE.md`, and the public repository surface. Every finding was traced in
code before it was repaired. Every repair PR then went to an independent agent
that had not written it, and was reworked until that reviewer found nothing
blocking. Most PRs needed two to four rounds. Each repair has a regression test
that fails without it.

## Findings and dispositions

| Area | Finding | Disposition |
| --- | --- | --- |
| Uploads | Anonymous callers could create public media with any capture token | Fixed in #564: live capture session required at begin, upload and completion |
| Subscriptions | Customers could switch to any active plan, including hidden or staff plans, before paying | Fixed in #564: public-signup eligibility; dearer plans granted only after the proration invoice is paid |
| Quotes | Any signed-in customer could post as the business | Fixed in #564 |
| Site chat | An unverified chat could take over a customer's thread and receive the owner's replies | Fixed in #564: unverified chats always open their own conversation, marked in the inbox |
| Contact import | Revert overwrote later staff edits | Fixed in #564 |
| MCP | Cookie-authenticated calls skipped CSRF and Origin checks | Fixed in #563 |
| Ads | `html_tag` creatives received the CSP nonce (ads staff to owner) | Fixed in #563: sandboxed opaque-origin frame |
| Redirects | `/\host` and dot-segment paths escaped the site after step-up | Fixed in #563 (`safeLocalPath`) |
| Auth | Site-wide password-change limit; personal keys skipped step-up | Fixed in #563 |
| Mail | Composed calls bypassed per-recipient magic-link and newsletter limits | Fixed in #563 |
| Rate limits | Limits keyed on a spoofable address, or on one shared bucket | Fixed in #563; Caddy recipes now send a trusted client-IP header |
| Card payments | Checkout, capture, refunds and Terminal ran provider I/O inside a transaction | Fixed in #561: claim → provider → apply; narrow definite-refusal list; 23-hour retry window |
| Payouts | A seller could be paid after a refund cancelled the payout; uncertain retries could pay twice | Fixed in #560: first attempt keyed on payout id; no automatic resend after an unknown, unclaimed or stale outcome |
| Abuse imagery | A scanner error put ordinary photos under a permanent legal hold | Fixed in #560 |
| SMS, capture, calendar, mail import, LLM | Provider or storage I/O inside transactions | Fixed in #565; the boundary gate now scans every service file |
| Contact merge | Polymorphic `subject_id` references were not repointed | Fixed in #565 |
| Dependencies | High-severity Vite and launch-editor advisories (test tooling) | Fixed in #562 |
| Secret scan | The scheduled scan failed on placeholder fixtures | Fixed in #559; no real secret has been committed |

## Open residuals for the reviewer

- **Coupon guessing** is effectively unbounded on deploys without a trusted
  client-IP header (managed platforms and plain Docker). Unusable codes share
  one answer, but a working code is still distinguishable.
- **`catalog.checkoutCart`** accepts `couponCode` with no rate limit. It is
  safe only because anonymous callers are refused today, and must gain limits
  before a public storefront checkout ships.
- **Provider-billed subscriptions** moving to a platform-billed plan are
  granted before payment.
- **Hosted refunds** whose provider answer was lost are recoverable only by a
  same-key retry within 23 hours.
- **Payout adapters** (Stripe Connect, PayPal, Razorpay) have not run against
  live sandboxes.
- **The mobile app lockfile** carries two unpatched high advisories in Expo
  build tooling. They were dismissed as tolerable risk because the app is not
  shipped; re-review when patches publish.
- **The public playground** runs on the same droplet as production.
