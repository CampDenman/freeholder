<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Commercial full82 source corrections — 2026-11-13

C9.33/C12.38. Finite SOURCE ONLY correction on exact combined `32d4b054`.
MASTER §43 remains the only status authority. The first actual full82 type
check failed15 diagnostics; its log is preserved unchanged at
`/tmp/freeholder-current-full82-types-v1-20261113.log`. This slice addresses
the seven reported commercial/subscription diagnostics by source inspection.
It does NOT claim those diagnostics or the complete check now pass. Root owns
the separate media corrections and qualification. No compiler, lint, test,
build, install, database, native, provider or business operation ran here.

The customer invoice contract and actual shared-service handler both omitted
`creditedMinor`. Consequently a cast, fabricated zero or removed display row
would leave the balance wrong: a5250 invoice with2100 applied original credit
and zero cash would appear to owe5250 instead of3150. The authorized customer
response now includes the actual safe nonnegative stored amount. The existing
InvoiceView display and `invoiceOutstanding` calculation consume that real
field without casts/defaults or a UI-private calculation. InvoiceView itself
needed no edit. UI, HTTP and MCP use the same shared output; existing private
link/session authorization, fee/routing exclusions and audit semantics remain.
SDK/output-contract drift still needs actual regeneration/qualification.

The commercial principal-state Zod object is retained as a concrete shared
constant, used by both the private principal query and extended authorized
review output. The review no longer dereferences optional widened service
metadata as if it were an extensible ZodObject. Fields, validations, authority,
cash/fee distinctions and receipts remain unchanged.

Card collection checks explicit `skip` before nullable IDs. The original
discriminated skip branch already implies NULL payment, so checking it after
the ID guards was unreachable to TypeScript. Reordering preserves every
guard/return and all actual POST/GET/raw-cash/finish/application behavior.
Both native fixtures now require their actual original seller before creating
the target; no undefined actor is replaced by a different permission context.
The actual card job lookup uses its original queue constant AND retained job
UUID, preserving the exact original-body equality assertion.

The existing first gross-proration native control is strengthened with actual
`getCustomerInvoice` calls using the genuine invoice-link signer for the real
issued invoice and anonymous capability path. It asserts total5250, credit2100
and cash0 → remaining3150, then actual cash1 → remaining3149. All original
principal, credit, fee, access/calendar and recovery assertions stay intact.
The extension is PREPARED/UNRUN. No financial rows are fabricated/backfilled,
ServiceContext synthesized, output cast or schema proof weakened.

Only the authorized commercial/customer/card source files and existing two
native files changed, with this note, MASTER annotation and customer-facing
changeset. Root's eight WIP files, media correction ownership, three central
readers, all original SQL/fragments/schemas/witness helpers and prior artifacts
remain untouched. Carrier was notified to preserve the exact correction in
its isolated provider descendant. Full renewed source/SDK/native qualification,
independent review, actual acceptance and stable gates remain open.
