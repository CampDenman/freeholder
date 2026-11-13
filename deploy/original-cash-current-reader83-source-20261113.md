<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original cash ordinary inventory reader — 2026-11-13

C12.38/C1.08. Isolated SOURCE ONLY continuation of parent `f64bff4e`.
No compiler/lint/test/PG/native/provider/build/install operation was run.

The existing `currentOriginalCashInventory` body moves unchanged to
`invoicing/original-cash-inventory-current.ts`. The registry module imports and
reexports the same ordinary reader; services, audit, callbacks, protocols,
actual original caller/finish proof, raw feedback matching, bank inventory,
revision fence and returned-cash policy are unchanged. There is no lazy lookup
or missing-service fallback. This allows typed financial readers to reuse real
authority without importing an entire service-registration module.

`merchantRefundCashHistory` now returns `inventoryCount` for the combined
original families and marks total greater than5000 incomplete. A per-array
bound cannot stand in for this total. Callers already reject incomplete
history; the existing digest still binds the same full retained rows. This is
an additional refusal for a genuinely incomplete aggregate, never truncated
acceptance. No SQL tail or root-owned central witness file is changed.

This source supplies no new principalSafe claim. Receipt-only/raw-before-owner
principal controls and the gross fee reader will compose the ordinary reader
with authenticated exact-source cash witnesses separately. Actual source
qualification, native recovery and stable gates remain open.
