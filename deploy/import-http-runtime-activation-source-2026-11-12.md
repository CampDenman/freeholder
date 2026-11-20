<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# C3.47 public saved-source activation — source checkpoint

This checkpoint wires the actual saved-response implementation into the shared
service registry, eight private models, original-generation privacy collector,
durable jobs and private search/retention inventories. `imports.previewFromUrl`
initializes the source without network I/O in its transaction. Public
`imports.advanceCrawl`, `imports.crawlProgress` and `imports.cancelCrawl` use the
current caller and shared audit path. Private claim/apply and System finish
services remain external:false. The phase limit remains600/hour, original
network pacing remains500ms and physical response budgets remain unchanged.

The owner page has saved progress and bounded continue/pause/stop controls in
English, Spanish, French and Arabic. A live HTTP source does not offer uploaded
file restoration. Existing graph review, commit, reconciliation, explicit
publication and rollback remain shared operations. Minimized media projections
can be displayed without parsing them as the original private file plan.

Two recovery operations are explicit and require a fresh human owner session:

- `imports.recoverCrawlResponse` requires the exact settled original physical
  receipt and original-body checksum, plus an actual finished-wrapper fact or
  reviewed original storage evidence. It uses a new current-owner phase lease;
  original URL, executor, response membership, key and namespace never change.
  A matching GET or lease expiration alone is insufficient. An admitted wrapper
  receives an immutable token digest; only its actual finally path can supply
  the private finish capability. Missing historical proof remains recovery debt.
- `imports.restartCrawlReview` creates a distinct run/generation from explicitly
  reviewed origin and source URLs. An immutable source FK records review lineage
  without adopting old capture, erasure or retention membership. Older accepted
  work and original-source cleanup stay separate. Minimized/erased originals
  cannot be restored or reconstructed by this operation.

The two new native oracles cover actual lost domain acceptance after a settled
PUT with a different freshly authenticated owner, and explicit expired-source
restart while the original generation remains held. They are prepared source,
not executed acceptance. The latter models Date-only expiry after actual I/O
has finished; its clock never establishes stopped-writer authority.

This is UNQUALIFIED source. The migration81 draft has additional fields and is
still unjournalled. Before a normal81 proof, compose the complete latest
qualified bank/finisher80 source and SQL, retain every published0–79 byte,
compose the separately qualified media-key repair and freeze a new81 hash.
Then use a NEW database for model/guard parity, public service/API/MCP/SDK
qualification, actual two-process continuation, privacy/recovery/lifecycle
controls and a Node22 production artifact with all four owner browser locales.
No existing database, artifact, golden or successful real501 proof is replaced
by this source work. C3.47 and full stable-release acceptance remain open.
