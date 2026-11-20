<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Accepted commercial amendments and future invoice lineage — source only

MASTER §43 C12.38/C9.38. This is an isolated source checkpoint, not a passing
qualification, collection activation, live provider acceptance or stable sign-off.
It builds on frozen a8281b63 (original read/unpaid-action recovery) and 8f0e2dfd
(supported draft finalization). The narrow actual-producer internal version
normalization from 27513d64 is also carried; root already qualified that separate
repair on the current financial assembly. That evidence does not qualify this
larger source delta.

An owner or the actual buyer reviews the next-period merchant, net price,
calendar, original outstanding setup obligation, dated tax destination and notice
before accepting an opaque quote. Earlier terms, prices, notices and invoices
remain immutable. The receipt records the actual caller and the actual queued
job/payload claim. A privacy cohort is never fabricated to authorize amendment
work. New privacy/hold, seller, account, fee, calendar or offer disagreement
refuses new work. The same services serve localized owner/customer screens,
HTTP and MCP. Recovery requeues the retained failed/cancelled job; it does not
create a replacement physical caller.

Provider restarts retain normalized immutable generations. A successor requires
another explicit accepted amendment and the predecessor's current full original
stop/caller/cash proof. First primary/subscription references and all earlier
operations stay historical; only the current logical projection may move.
Positive contradictory references remain in the original journal without being
promoted to another generation. Actual GET recovery remains distinct from the
original POST/ACK/returned-caller lifecycle. Retrying an unknown successor never
cancels it merely to admit a second POST.

Authenticated invoice-payment/PI callbacks commit positive money before the next
page, fee, transfer, line or price GET. The shared original-money inspector
supplies actual fee/recipient facts; no fee calculator or synthetic tax authority
was added. Complete paginated invoice lines and independent actual prices are
retained in normalized append-only rows. Application requires their exact
operation, accepted terms, phase digest, customer, gross price/product, currency,
full-precision quantity, recurring calendar and unadjusted invoice facts.
Dynamic subscription-line metadata does not supply historical consent. Canonical
net/setup lines, the original dated tax receipt and the existing shared fee
receipt must reproduce the admitted phase before scheduled cash is applied.
A genuine zero invoice uses its own invoice witness and invents no PI, cash
receipt or payment. Partial cash does not advance access. Manual/platform
amendments also keep their prior plan/calendar until the exact issued period
invoice is fully paid.

The four new families participate in bounded buyer and original merchant merge
fingerprints; overflow refuses undo. Privacy export includes accepted amendments
and observed period totals, excluding the other party's bank resource IDs.
Search/retention explicitly keep immutable lineage out of global content search
and automatic TTL deletion. Existing original agreement privacy/financial holds
continue to govern minimization.

The only SQL change is the owned UNAPPLIED suffix
`deploy/subscription-commercial-amendments80.fragment.sql`, after the frozen
173898e8 stop tail and ea555f14 recovery tail. It creates four normalized tables,
actual queue/generation/accepted-terms guards, deferred complete invoice-line
proof and canonical scheduled-cash lineage enforcement. Root owns append order,
combined SQL hash, model/readiness metadata and a NEW normal database. The old
assembled 3a686245 SQL and both old fragments remain unchanged. The suffix has
not been assembled or executed here.

Prepared controls (all UNRUN):

- 21 pure admitted-period boundary controls, including foreign customer/operation,
  another acceptance, price/product/date disagreement, full-precision quantity,
  proration/adjustments, metered/transformed price and genuine zero invoice.
- Six intercepted authenticated invoice-line/price GET controls, including actual
  pagination, duplicate pages, another invoice and out-of-band credit settlement.
- Existing cash controls updated for later actual fee/line/price reads, with a new
  positive-money-and-fee-before-price-failure control. Synthetic provider HTTP
  remains explicit.
- Two native amendment controls through the ordinary actual producer and retained
  registered job body, with distinct generations, immutable originals, retry and
  customer/opaque-consent refusal. No invented ServiceContext, queue payload or
  JobExecutionContext.
- One native manual amendment control proves an issued unpaid period cannot
  advance the plan/calendar, and repeated billing keeps the one frozen invoice.
- Three native controls enter the real raw-HMAC payment HTTP route: exact
  canonical net/setup/tax/shared-fee positive, contradictory actual price and
  contradictory full-precision quantity. The negative controls require committed
  cash and normalized disagreement, zero canonical invoices/payments, unchanged
  access, and raw immutable-line update refusal.

No compiler, lint, test, native/PG, generator, build, install or provider I/O ran
for this checkpoint. Only source inspection, public official documentation,
`git diff --check` and fragment SHA-256 inspection occurred. The normal root
qualification/new-database lanes remain required. Browser/accessibility,
SDK/OpenAPI regeneration/consumer checks, all six native controls, current SQL
raw-positive/negative checks, wider legacy/recovery regression and real enabled
payment acceptance remain open. Late/missed-boundary explicit re-consent is the
next required finite recovery slice: this source refuses backdated creation and
never rewrites a previously accepted effective date. It is not deferred out of
specification.

Official provider references inspected 2026-11-13:

- https://docs.stripe.com/api/invoices/delete — subscription invoices are excluded.
- https://docs.stripe.com/api/invoices/finalize — supported finalization with
  `auto_advance=false`; that flag alone proves neither no existing PI nor no cash.
- https://docs.stripe.com/api/payment_intents/cancel and
  https://docs.stripe.com/api/invoices/void — distinct actual stop operations.
- https://docs.stripe.com/api/invoice-line-item/object — `quantity` truncates
  decimal precision; `quantity_decimal` carries the actual quantity, and
  subscription line metadata can reflect current mutable subscription metadata.
