<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original multipart operation qualification

C1.12 and C11.08 remain open. This source increment preserves original private
S3 multipart uploads while recording CREATE, COMPLETE and ABORT independently
from ordinary object PUT/DELETE receipts. Original resource binding, logical
reservation owner and ordered completion parts are immutable. Physical provider
calls happen after short reservation transactions; positive acknowledgements
are recorded before further inspection. Unknown calls are not blindly retried.
ABORT retirement requires original ListParts absence and no completed object.
Lost CREATE replies require a complete exact-key multipart inventory, with
fresh stopped-writer and original-provider evidence supplied by a person.

Local evidence on 2026-11-11, using synthetic private providers and disposable
Postgres only:

- Actual main72 completed an upload through a replacement provider namespace;
  its original before control failed. The replacement refusal and supported
  cancellation after controls now pass together (2 tests, 13.30 seconds).
- Unmodified root75 WIP completed customer erasure while a proxy request was
  paused in its scanner, then made one new physical PUT after erasure. That
  exact before control failed in 9.60 seconds. The unchanged after control
  passes in 7.15 seconds with completed erasure and zero new physical PUTs.
  This attribution is to the root75 checkpoint, not a separate main72 proof.
- Six adapter controls pass: no hidden CREATE retry, HTTP200 embedded COMPLETE
  error, positive COMPLETE ACK followed by failed HEAD, empty-open versus
  NoSuchUpload, full paginated exact-key inventory and malformed inventory.
- Full typecheck and lint passed. Static contracts pass all 42 required files,
  380 tests plus one explicit exclusion; playground policy and private-service
  inventory also pass. Journal75 is intentionally not changed in this branch.
- A fresh official migration chain through74 plus explicit unpublished75 SQL
  succeeded. This is not contiguous journal75 upgrade qualification.

The temporary direct-abort refusal in root75 WIP was a compatibility regression
in an unfinished repair. Original main72 cancellation worked; it is not counted
as a preexisting launch defect.

Further qualification remains for lost-call recovery, concurrency, original
owner versus executor, native PUT/DELETE and capture regression coverage,
four-locale owner browser acceptance, SDK generation, actual old-artifact HTTP
refusal and contiguous upgrade. Breaking migration75 requires actual old direct
writers to stop and drain. Readiness refusal cannot stop an already admitted
network request. Cross-target adoption/source cleanup, completed-erasure
reopening after a contradictory late provider fact, live storage acceptance and
independent review remain explicit completion dependencies.
