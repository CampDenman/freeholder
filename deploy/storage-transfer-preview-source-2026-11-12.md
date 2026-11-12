<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original storage-transfer preview (C1.12/C11.08)

`media.previewStorageTransfer` is a shared, human-only query for a person
with media management permission. It captures the configured original storage
binding outside the service transaction, then uses a private service phase to
lock each requested object in stable digest order and read its complete
physical receipt history. The target contains resource names only; credentials
and arbitrary locator fields are refused.

The query accepts at most 25 keys and reads at most 10,000 receipts across the
request. It refuses an oversized history instead of hashing a partial result.
Every requested object's live original facts must agree on its actual source,
SHA-256, byte count and content type. Unresolved, redacted or missing original
facts, a named storage hold, duplicate keys or an identical target stop it.
The returned inventory digest includes every original receipt witness and
the exact source and target bindings. Private receipt identities and original
contact subjects are not returned.

This query performs no object GET, PUT or DELETE and writes no transfer plan.
Its three permission fields are always false. It does not prove complete site
inventory, subject eligibility, stopped writers, target quota, provider bytes
or subsequent caller completion. Claim, copy, adoption, source cleanup,
retention/merge wiring and actual cross-target acceptance remain open.

Full Node22 types and changed-source lint pass, as do 51 selected private
service/schema/transfer controls. Three actual normal79 PostgreSQL controls
pass in 4.20s, 3.95s and 4.35s: complete-history preview without receipt changes
or object I/O; principal/resource/duplicate refusal; and a newly applied named
hold. The first also adds another accepted receipt and then an unresolved
receipt, proving both the digest change and subsequent refusal. Provider
endpoints are unavailable synthetic fixtures; no provider acceptance is
claimed. Actual SDK registry generation and all eight SDK controls pass,
adding the public query and excluding its private phase. The generated SDK
then passed full Node22 types and whole-repository lint (91.4s). License,
release notes, plan and playground gates pass. The full 44-file contract run
had one deterministic changelog drift failure (383 passes, 26 skips); actual
changelog regeneration followed by the affected three controls passes,
resolving that failure. No unrelated tests were repeated. The dependency
tree was reused after exact manifest/lock comparison; pnpm's worktree-path
warning was retained and did not trigger an install. All native sessions drained; separate SQL
confirmed no remaining database backends, fsync on and the explicit local
jit-off profile.

Follow-up source validation: unsupported local storage and malformed captured
bindings now produce an explicit service validation error instead of a raw
schema exception. Full Node22 types, changed-file lint and all12 affected
evidence projection controls pass. The authenticated-URL refusal fixture
constructs its explicit fake userinfo through URL properties; the original
credential-shaped literal was removed from the unpublished PR history after
the secret scanner flagged it. The scanner configuration is unchanged.
