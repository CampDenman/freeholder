<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Reachable idle compact lifecycle fixture

C1.12/C11.08 remain open. This finite fixture-only descendant preserves frozen
`0ca7c3eef88ef9c993dbde60c77f3d260fbf6dd0` as its BEFORE. No product, SQL,
model, service, permission, capability, provider helper or earlier oracle is
changed. The eight case titles and all expected assertions stay intact.
Compiler/lint/parser/collection/tests, database/native, provider/host and hooks
are UNRUN; the finding is source inspection, not an observed native result.

Four finite setup corrections satisfy the existing public contracts:

1. Seed the existing real CUSTOMER actor's separate customer-role user row.
2. Link the actual subject contact to CUSTOMER, then perform its owned actual
   begin/abort as CUSTOMER. OWNER remains the permissioned privacy/recovery
   person. No extra grants, roles, fake ServiceContext or service bypass exists.
   `contact.credentials` correctly refuses erasing an owner/staff-capable login.
3. Supply the actual required `confirmation: "ERASE"` when fulfilling the
   genuinely verified erasure request. That confirmation is not a privilege or
   replacement for any physical proof.
4. Place the hold through a separate actual created/verified erasure request
   for the SAME subject before starting the original pending worker. The old
   request and original expected results remain unchanged. Source inspection
   of `createDataRequest`, `verifyDataRequest`, `addRetentionException` and
   `refusePendingErasure` confirms that creation has no duplicate-contact ban
   and the applied-receipt mutation refusal checks the supplied request ID;
   its shared contact lock does not make it a contact-wide refusal. The hold
   itself still applies to the subject across requests, as intended.

The source freeze records the exact whole-file reverse transformation back to
0ca, hashes every unchanged product/SQL/helper, and retains all eight original
expected assertions. No fixture capability is published. Actual native target,
independent ledger/profile/drain proof and the rest of full media acceptance
remain required after root qualification and genuinely complete capabilities.
