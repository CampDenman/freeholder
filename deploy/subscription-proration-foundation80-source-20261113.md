<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Proration arithmetic, paid-access repair and current integration boundaries

MASTER §4.15 and §43 C9.33/C9.38/C12.38. This is an unqualified finite source
checkpoint following frozen3f3ae63f. It is not the full merchant proration
implementation and adds no deferral. Full canonical/provider lifecycle work
continues in separately reviewable source increments.

The existing plan policy is preserved: `none` defers to the original period end;
`create_prorations` uses separately rounded unused old/new prices for a local
manual/platform adjustment, while provider billing uses its own actual
proration. Exact BigInt arithmetic now retains the existing half-up rounding of
each nonnegative component without multiplying safe minor amounts by floating
point time. Invalid periods/amounts refuse; an instant before the period cannot
create more than the whole original component, and an expired period has no
unused portion. This helper supplies no tax, fee, consent or provider authority.

An owner requested positive local proration used to bypass the customer's
paid-access guard. The same ordinary invoice now holds every actor's change
until issued, fully paid and unrefunded, with the actual original buyer,
currency and subscription source. Partial payment keeps the original plan.
This small repair is isolated in commit de2dff55 and the extractable patch
`/tmp/freeholder-proration-paid-access-main-compatible80-20261113.patch`.
Its source touches no80 family or SQL. The actual manual native oracle in
`tests/modules/subscription-proration-paid-access.test.ts` has no80 imports: it
starts and actually pays an ordinary original manual period, advances halfway,
requests the owner's upgrade, proves original plan/grants through partial
payment, then pays the exact remaining invoice. It requires the original paid
invoice/calendar unchanged and two invoices/three real shared payment rows,
with no duplicate on retry. It is prepared UNRUN for root's unchanged
BEFORE/AFTER main-compatible qualification; no passing result is asserted.

Implementation decisions supplied by root on2026-11-13 within the authorized
full-spec task, recorded here and in MASTER rather than invented by a backend:

- Preserve the accepted trial end by default. An uncharged trial has zero old
  paid principal/unused credit. A plan change must neither silently end/extend
  that trial nor bill its remaining trial window. No early-trial-termination
  feature is added by this decision.
- Manual/platform interval changes preserve the original accepted calendar:
  the new interval begins at its original boundary. Provider preview's actual
  anchor/reset/invoice effects must be shown and bound in explicit consent.
  Backend calendars need not be silently made equivalent.
- A negative adjustment issues an exact original credit through the existing
  ledger. No automatic cash refund is inferred. Canonical credit application
  must be a real noncash credit disposition, never a fabricated payment or
  negative cash entry.

`reviewedProrationCalendar` states these decisions as a typed pure contract.
The new internal provider preview request/observation schemas bind original
generation, request, journal/resource revisions, original credit capacity,
price/tax/fee receipt digests, exact proration instant, actual old/new calendars,
trial effects and complete bounded raw lines. They are not yet wired to a
provider or public acceptance service. A schema parse cannot turn a caller's
object into bank evidence.

Current missing integration, all still required under the existing C12.38 item:

| Path | Existing behavior and required completion |
|---|---|
| Original merchant agreements | Legacy `changePlan` refuses them. Future-only terms/SQL admit a next-period start and flexible full-period phases explicitly reject adjustments. A separate accepted mid-cycle model must preserve old terms/invoices and keep those DTOs strict. |
| Local charge | Exact unused net can form an ordinary invoice, but a new merchant quote/consent, original dated tax and fee ownership, immutable canonical charge/credit relation, and fully paid activation still need integration. |
| Negative credit | Shared issued credit notes exist. There is no current credited invoice counter or credit-note application service. `paid_minor` is actual payment money, and `invoices_paid_consistent` currently requires it equal total. A real shared noncash credit application needs independent immutable capacity and disposition, not fake payment rows or repurposed paid cash. |
| Trial | Existing legacy code treats the trial window like paid time. The new calendar contract expresses the required preserved-trial behavior; actual legacy/new merchant lifecycle integration remains to be completed. |
| Provider | The current future-phase adapter forces no proration and full accepted periods. A separate actual preview/update/invoice admission lifecycle must bind the same proration date, actual anchor/trial effects and complete raw debit/credit lines; retain cash before later auxiliary failure; and use the existing actual caller/nonce/finish/stop/current-scope patterns. |
| Recovery | Unknown original mutation or read callers remain debt. Exact partial/cash/credit disagreement must not grant access or allow another physical charge. Existing future-only and missed-boundary re-consent remain available. |

Official Stripe documentation inspected2026-11-13:

- [Create a preview invoice](https://docs.stripe.com/api/invoices/create_preview):
  preview is not an issued invoice; bind the same proration date for the update.
- [Update a subscription](https://docs.stripe.com/api/subscriptions/update):
  interval/free-to-paid/trial changes can reset billing dates; prorations are
  not necessarily immediately invoiced. Actual effects must be accepted, not
  guessed from a local unused-fraction result.
- [Update a subscription schedule](https://docs.stripe.com/api/subscription_schedules/update):
  request-level proration concerns a current phase update and is distinct from
  phase transition behavior. Existing future-only phase receipts stay strict.

Prepared UNRUN: thirteen arithmetic controls, fourteen calendar-policy controls,
the new ordinary paid-period owner native oracle, and the tightened existing
owner proration native control. No compiler, lint, test, PG/native, generator,
install, build, browser or provider I/O ran. Only source/diff inspection and
official public documentation reading occurred. No SQL suffix is changed or
added by this foundation; all earlier signed reader/late-consent fragments and
the three root-owned central financial witness files stay untouched.
