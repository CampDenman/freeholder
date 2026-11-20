<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->

SOURCE ONLY — C1.08/C9.33/C12.38 original-owner paid-access privacy repair.

The actual period completion service previously checked money, bank, calendar and
accepted terms but did not check verified erasure/retention before new access.
Verification changes the data request; it does not immediately set the contact's
erasure marker. A live contact alone therefore did not supply this policy.
This change applies the same three write predicates as the existing controlled
collection authority: erased marker, verified erasure in the four existing
blocked statuses, and unexpired holds in the four existing financial/privacy
scopes. Ownership comes only from actual collection → quote → resource → parent,
accepted terms and invoice, and the frozen quote.profileId merchant. It does not
reprice against today's profile version or accept caller-supplied owner IDs.
Missing installation or ownership refuses. Historical already-applied no-ops
remain no-ops. Retained money and GET-only recovery remain available.

Five shared writer changes precede every contact/request/resource/canonical lock:
verifyDataRequest, auto-verified createMyDataRequest and reopenErasureJob acquire
the existing nonblocking exclusive identity prefix; resolveContact and
updateContact do so only for reserved-marker intent. Ordinary source/profile
edits and all existing status, permission, retention and fulfillment bodies are
unchanged. resolveContact genuinely can fill an existing missing source, including
its raced insert fallback, so this conditional fence occurs at entry. Existing
retention changes, merge/undo and fulfillment already acquire exclusive identity.
Current paid-effect service holds the matching shared prefix through commit.

The owned UNAPPLIED SQL suffix follows the entire 624,213-byte normal85 prefix.
It adds five functions and three nondeferrable BEFORE row triggers (manifest has
exact names, signatures, hashes and event bits). The actual pg_locks predicate
requires current backend/database, granted ExclusiveLock and both exact bigint
key words with objsubid=1. A shared lock, wrong key or another backend's lock
cannot authorize a writer. No GUC/session marker or late lock acquisition supplies
authority. pg_locks proves a held exclusive lock; it does not distinguish session
versus transaction lifetime. Shared services use the existing transaction lock.
The new request guard also fences contact rebinding of an already-verified
request or request carrying an active relevant hold. The hold guard fences
request/scope/expiry rebinding. contacts INSERT is deliberately untouched: a new
unreferenced contact cannot be an existing accepted target owner; UPDATE into
the reserved marker requires the prefix. Legitimate merge/undo keeps its existing
exclusive prefix. Every previous constraint and branch remains installed.

The independent paid-period SQL source gains one privacy predicate. The complete
old function reverses byte-exact by removing that one insertion. Its ready
successor retains every earlier function/trigger pin and pins all new complete
bodies and enabled exact trigger identities. Full old shared-writer source files
also reverse to their recorded SHA256 values. There are zero new models, columns,
services, permissions, flags, sensitive audit fields, financial witness families,
privacy export families or retention policies. Original paid155 and other native
files are untouched. Parent owns normal SQL assembly, strict schema/body/trigger
qualification and central manifests; no existing source is grandfathered safe.

Prepared controls (ALL UNRUN):

- tests/modules/controlled-paid-privacy-source.test.ts: four whole-source/body,
  old-prefix, actual-lock-key and binding guard contracts.
- tests/modules/controlled-paid-privacy.test.ts: actual verified buyer and merchant
  erasure AFTER genuine money commit but BEFORE independent access, then actual
  original invoice.paid retry; both genuine concurrency directions; direct SQL
  onset, shared/wrong/foreign lock and actual request/hold rebinding refusal.

Native setup uses actual accepted period → producer collection → fresh real
manifest → exact canonical receipt → independent returned bank GET → real
private batch writer. It holds only the genuine postcommit paid-event dispatch,
never the permission, proof, verification, bank or access path. Transactions and
ctx calls are real. Runtime is genuinely warmed after stopJobs. No test changes
an existing oracle, fabricates verification rows, supplies a proof, invokes
provider I/O inside a transaction, or treats this source checkpoint as acceptance.
No compiler, lint, tests, PostgreSQL, SDK, provider-account or host action ran.
Full specification, proration, enabled-provider acceptance, independent security,
launch and stable sign-offs remain open.
