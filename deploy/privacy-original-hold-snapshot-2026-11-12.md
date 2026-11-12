<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Documented original hold snapshots (C1.08/C3.47)

An actual unregistered HTTP-crawl control reproduced deletion of a privately
captured original after a pending erasure request had received a named reader
hold. The hold existed, but original response membership was not captured
until erasure fulfillment. Existing fulfillment retention callbacks cannot
simply run earlier: some also disable credentials or retire data.

`ContactPrivacySource.captureRetention` is a separate optional,
non-destructive membership callback. The existing shared
`contacts.addPrivacyRetentionException` service invokes it after the actual
hold upsert, inside the same identity/request locks and transaction. It
receives the real service context and applies to both a directly held source
and parents declaring that retention scope. No provider I/O, retirement or
credential changes belong in this callback.

The callback's `isNew` flag comes from the original indexed request/scope
lookup under the identity lock. An update cannot pretend an originally empty
snapshot was a new hold and acquire later source generations. Callback
failure rolls back the hold and all earlier snapshot effects. Existing
`retain` callbacks remain fulfillment-only. Existing sources without the new
callback keep their behavior, API permissions and audit identity.

Source and native qualification are pending. The three actual-service
controls cover inherited scope capture before verification, real insert vs
update identity, atomic rollback on first creation and preservation of the
prior hold/snapshot on a failed update. The crawl domain must separately
record normalized original source-generation membership and qualify its
held-byte, zero-response, late-fact, update, expiry and release paths. The
core callback alone does not close C3.47 or prove provider acceptance.
