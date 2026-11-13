<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Preserve null results at the HTTP boundary

MASTER §43 C3.03/C3.22/C3.47. The first actual incoming WXR journey at
8f278611 successfully streamed the original bytes through TCP, reviewed the
501-entry source graph, committed the first 500 drafts through the generated
SDK and resumed the last entry through incoming MCP. It then failed its
unchanged public-read assertion: an unpublished page resolved to `{ok:true}`
over HTTP instead of the service's legitimate `null` result.

The shared route used a nullish fallback for its response body. The correction
uses the acknowledgement only for `undefined`, preserving explicit null and
other JSON values. It changes no service permission, actor, transaction, audit,
CSRF or publication rule. Six focused controls cover null, false, zero, empty
text, explicit presenter null and the existing omitted-body acknowledgement.
The original incoming WXR/REST/refusal journey bodies remain unchanged.

The failed V6 database is preserved. Independent read-only evidence records
501 source entries, two accepted commit batches, all 82 journal hashes and
drained clients, without exporting the original source bytes or private data.
Before this failure, all three raw-feedback owner controls passed with their
own independent money/receipt/hash/profile/drain proofs: historical raw payment
feedback, contradictory original refund PI, and an authentic receipt without
a canonical payment or invoice. No provider account was contacted.

Full types and focused HTTP lint pass. The initial source runner selected
the database-dependent service-route tests without a database; that attempt
is preserved separately and does not qualify those controls. The HTTP suite
and corrected incoming journeys require a new isolated database. Their
qualification remains pending. No stable, upgrade, browser, platform or
provider acceptance follows from these component results.
