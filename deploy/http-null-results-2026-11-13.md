<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# HTTP null results and the generated SDK

MASTER §43 C3.03/C3.22/C3.47. A service can legitimately return null, for
example when `cms.resolvePage` cannot expose a draft. The shared HTTP wrapper
replaced that value with `{ok:true}`, contradicting the generated client's
nullable result. It now uses the acknowledgement only for an omitted body
(`undefined`), preserving explicit null and all other JSON values.

Six focused controls cover null, false, zero, empty text, explicit presenter
null and the existing omitted-body acknowledgement. They use actual service
calls and the shared HTTP wrapper; permissions, actors, transactions, audit
and CSRF remain on that same path. No schema, registry, SDK generation or
deployment configuration changes.

The original failure was observed over actual incoming TCP in a separate
integration candidate: a synthetic 501-entry WXR import committed 500 drafts
through the generated SDK and resumed the last through MCP, then failed the
unchanged public-read null assertion. That database is preserved with a
minimal independent row/hash/journal/drain proof. The route and pre-existing
HTTP test source at that failure are identical to protected main bedafa0a.

In the corrected integration candidate, all 28 HTTP controls pass, and the
unchanged incoming journey passes its null, publication and rollback checks
before a separate audit-selection assertion stops the test. This does not
qualify the complete import journey. Main-based qualification below covers this
narrow repair. It supplies no stable release,
provider-account acceptance, security review or owner completion signature.

## Main-based source qualification

Against protected main bedafa0a, full types pass in 50.896 seconds and whole
repository lint in 93.147 seconds. All 44 required complete source contract
files pass with 384 actual assertions and 26 explicit database skips; the
public playground policy adds two passing controls. No required file is empty
or pending. License, release-note and plan gates pass. The unchanged generated
changelog equality test first required refreshing `CHANGELOG.md` from the new
changeset; its failed attempt is preserved, and the six unfinished complete
files then pass without repeating the 38 already qualified. The package stays
at 0.2.0-beta.6. Its database qualification is recorded below.

## Main-based database qualification

At f245080ba0f9d980ce8bd941b07491c140a20dfa, a NEW isolated database applies
ordinary migrations 0–79 in 5.327 seconds. All 80 installed timestamps/hashes
match source. Five affected complete test files then pass sequentially: HTTP
28, API 22, MCP 37, contract projections 1 and SDK 8, totaling 96 actual passes.
SDK generation remains unchanged. Each file receives an independent read-only
money/audit row-digest, journal and profile inspection before the next file.
All inspections confirm UTC, fsync on, jit off, no recovery and zero remaining
database clients. Every earlier failed component database stays preserved.

The main-based source and native proofs qualify this narrow response repair.
Protected PR and merge-queue CI remain required. No deployment or stable gate
has advanced.

## Browser contract follow-up

The first protected CI run at 3a29850b passed 42 checks and stopped on the
hidden-location browser fixture's former `{ok:true}` absence expectation.
Both `cms.resolvePage` and `locations.get` declare nullable outputs. The
fixture now expects null for the hidden page and both ID/slug location reads;
the hidden-list refusal, address omission, sitemap and POS/social checks stay
unchanged. No application behavior changed in this follow-up.

The complete focused Chromium journey passes locally in 14.345 seconds using
the unchanged, digest-verified application artifact from CI run43443715799.
The artifact ZIP and runtime tar hashes were verified; it contains no
environment files. Renewed full types and focused browser lint pass. Independent
read-only inspection confirms all80 migration identities and drained clients.
Full protected CI must pass on the updated PR head before queueing a merge.
