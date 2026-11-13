<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Current subscription commercial source (C9.38/C12.38/C1.08)

This isolated composition starts at current financial checkpoint `425642af`
and replays only the eleven owned commercial, phase, exemption and buyer-cohort
commits through `ddee2f75`. There were no cherry-pick conflicts or older whole-file
replacements. The earlier components have their own separate source evidence;
this new current-source composition is not qualified by transferring those passes.

The accepted-terms table is now registered in the actual subscription module,
with explicit private-search and no-TTL retention decisions. The seller's exact
frozen profile selects bounded accepted-term child fingerprints for contact merge
undo, including when no payment exists. PostgreSQL computes those row digests so
private accepted destinations/notices do not enter a merge witness. The buyer's
original agreement witness already retains the exact accepted-term rows.

The existing profile-version/registration/exemption child subqueries also now
retain their explicit outer table identity. An actual ORM query-generation
probe showed that a bare outer Column in a single-table SELECT renders as the
inner child's unqualified id; Table/identifier SQL chunks preserve the intended
profile correlation. This establishes the rendering behavior, not a native
business before/after proof. Actual original/foreign-profile undo controls remain
required on the new complete schema.

The owned commercial-terms fragment is appended once after unchanged SQL958.
New unpublished80 SHA256 is
`881a7901abf41dc612081df422d6623370e0a68150421f61cc13e96664c43f7d`.
The complete previous SQL958 is an exact byte prefix; all published0–79 SQL and
the81-entry journal are unchanged. Every earlier database is preserved. This
candidate requires a NEW named database; no old fixture/schema is migrated in
place. Initial model/native/source qualification is still pending.

Provider phase admission remains false. Actual amendments, complete paid invoice
and returned-cash inventory, composed money-erasure finishing, browser/SDK/provider
acceptance and full C12.38 remain open. This is not stable or launch sign-off.
