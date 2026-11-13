<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Subscription financial undo identities — 2026-11-13

C1.08/C12.38. Finite SOURCE ONLY correction based on frozen root
`0dca8407dd3bafd6ad6df319551f07cea5fb028b`. MASTER §43 remains the only
product/status authority. No compiler, lint, tests, database, migration,
native, build, install or provider operation ran. This source closes no
feature, independent review, provider acceptance or stable gate.

## Concrete gap and narrow repair

Root's existing financial witness uses the exact authenticated identity
`namespaceDigest:actualFeedbackUUID` for `original_cash_feedback`. The actual
`subscriptionOriginalEvidence` helper retains that identity as
`kind:"refund_financial"`. The existing undo parser required UUID for every
kind, so a legitimate receipt-only feedback snapshot could be captured but
would fail schema parsing when undo tried to restore it.

The ordinary parser now lives in `merchant-scope-undo.ts` and is compatibly
re-exported by `merchant-scope.ts`. Its explicit discriminated branches keep
all16 ordinary evidence kinds strict UUID. Only `refund_financial` accepts
either the existing historical UUID or the exact101-character feedback form:
64 lowercase hexadecimal namespace bytes, a single colon and a valid UUID.
No transform removes the namespace, normalizes case or manufactures another
owner. Fingerprints and complete5000 bounds remain unchanged. This is format
validation; authentic ownership still comes from the unchanged current
financial helpers, namespace/HMAC proof and full undo-state comparison.

No financial table, row, namespace, signature, original admission/caller,
current bank proof, invoice/payment/receipt identity or SQL changes. Root's
five cash families and the separately frozen `f7bc597c` adapter are untouched.
The seven later card families remain root's separate composition work.

## Table identity and collision review

`subscriptionOriginalEvidence` already hashes
`JSON.stringify([entry.table, entry.fingerprint])` for every financial child.
That table-bound digest remains unchanged. The subscription snapshot keeps an
ordered array and undo compares the complete regenerated array. It does not
collapse financial entries into a map keyed by UUID. Separate FK-backed
tables can legitimately share an ID (for example original reads/finishes);
their distinct table-bound fingerprints remain separate array occurrences.
The existing invoice maps are keyed by actual invoice IDs, with financial
children folded inside their fingerprint, rather than by a raw child UUID.
No concrete map-collision defect was found in this current path. No general
ID relaxation, table-name guess, deduplication or historical snapshot rewrite
is included. Future composition must retain table+ID identity when making
maps; a safe projection cannot replace the original full child fingerprint.

## Prepared controls — all UNRUN

Twenty-nine strict parser cases retain exact namespace bytes and historical
UUID witnesses; reject composites for every ordinary kind; refuse malformed
lengths/digests/UUIDs, extra separators and whitespace; retain two table-bound
financial occurrences sharing a UUID; and refuse unknown kinds/overflow.

The existing actual NULL-payment subscription owner native now additionally
uses its already-produced signed bank feedback and actual receipt to call
`merchantRefundDependencyFingerprints`, then the real shared
`subscriptionOriginalEvidence`, then the exact undo parser. It asserts the
complete current snapshot parses unchanged and retains the original composite
ID plus its existing table-bound digest. All original real producer, HMAC,
privacy owner, no-payment/refund/cash-owner and unchanged receipt assertions
remain. No financial row, source binding or ServiceContext is fabricated.
This extension is PREPARED/UNRUN; the earlier component's native pass does not
qualify the changed control or parser.

A full global contact merge/undo is not claimed by this extension. Its
existing provider fixture has a real cart, and the known unrelated cart undo
guard must not be bypassed by deleting/backfilling fixture history or calling
a restore callback with a fabricated parent. Actual global merge/undo proof
still needs a legitimate fixture and fresh execution. Existing database and
first-failure evidence remain preserved; root owns qualification and final
combined composition.
