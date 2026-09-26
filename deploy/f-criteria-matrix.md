<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# F-criteria evidence matrix — C11.09

*C11.09's artifact. One row per live §43 C-item (row set computed from
`scripts/plan-gate.mjs` — never retyped), plus the seven §43.18 v2-deferred
mobile items, plus one row per workspace package and first-party plugin.
Columns are §43.2's F01–F12. Every cell is either a citation that resolves in
the repository or an explicit `N/A — reason`; nothing is empty, nothing is
"see above". `scripts/f-matrix.mjs` + `tests/core/f-matrix.test.ts` fail on
row-set drift, empty cells, unresolvable citations, citations of test files
outside the suite, and lazy N/A — the matrix cannot silently rot the way the
2026-09-13 audit caught evidence being stamped rather than proven.*

**Method.** For each C-item, the F04/F05/F07/F09/F12 cells transcribe the
item's own §43 annotation (plan-gate refuses a checked item that names none),
with a repository citation appended where the annotation asserted without
one. Cells for criteria the annotation does not name are derived, not
invented: F01 maps the item's migration tag onto the reviewed baseline
(`db/migrations/0000_reviewed-baseline.sql`, C10.19 — equivalence to the
pre-collapse chain is proven by `scripts/schema-baseline-identity.mjs` and
`tests/fixtures/c1019-chain.catalog`); F02/F03 cite the item's own test
files only where those files assert service-boundary or spine behaviour;
F06/F10 name the shared gates and say exactly what they do *not* prove; F11
names the changeset, deploy doc or annotation the claim lives in. Where no
honest derivation existed, the cell was curated by hand in this change. Rows
marked **v2-deferred** quote §43.18 verbatim; their obligations survive to
v2.

**Verification record.** See "Full-suite verification" below; every
`tests/…` file cited in this matrix was part of that run.

## How to read a row

- A backticked path is a claim you can open; `scripts/f-matrix.mjs` fails if
  it does not exist or if a cited test file is not in the suite.
- `N/A — reason` means the criterion does not apply to that row, with the
  specific reason why.
- "Shared gates only" and "Partial, honestly labelled" are deliberate: they
  record what the evidence proves and refuse to claim more.

## Full-suite verification

*Recorded by the C0.11 audit, 2026-09-16, on the final tree of this change.*

- **Command:** `CI=1 TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/<fresh-db> pnpm test` (vitest run, 349 files), executed twice — runs 3 and 4 below — each on a fresh disposable PostgreSQL 16 database.
- **Result (both runs):** 3,657 tests — 3,639 passed, 17 skipped (inapplicable deploy-recipe cases in `tests/core/deploy-recipe.test.ts`), 1 failed.
- **The one failure, both times:** `tests/modules/funnel.test.ts > the funnel > reports how many of a band were also in the one before it`. This is a pre-existing cross-file isolation flake, not a defect this change introduced or touches: the test asserts exact analytics counts on the shared disposable database and intermittently collides with a concurrently sequenced file's inserts. It passed 8/8 in isolation, failed identically on the pre-change tree (the audit's first verification run, before any file of this change existed), and involves no assertion any matrix row cites — C9.07's banding claims rest on the file's other band tests, which passed. Recorded and reported per the audit's rules, not silently fixed.
- **Run 3 additionally failed** `tests/core/changelog-output.test.ts` because this change adds a changeset without regenerating `CHANGELOG.md`; the changelog was regenerated (`node scripts/generate-changelog.mjs`) and the test passed in run 4 and in isolation.
- **Every `tests/…` file cited in this matrix was part of these runs.** The suite collects the whole `tests/` tree, and `tests/core/f-matrix.test.ts` independently fails if any cited test file is not in that tree — so a citation cannot point at a file the green run never executed.
- **HEAD:** branch `docs/f-criteria-matrix`, parent `2d9cac8` (`origin/main`); the matrix and checker are part of the commit this header ships in.

## C0.01 — Consolidate product specification, current state, dependency

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — the live plan is `MASTER.md`, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — planning, legal or CI text, not a composed product journey.

## C0.02 — Retire the root roadmap and JSON session backlog; remove every

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — a planning-file retirement gate, not a product surface.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — planning, legal or CI text, not a composed product journey.

## C0.03 — Record Tony Aly as owner of the original Freeholder copyright

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — copyright notices, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — planning, legal or CI text, not a composed product journey.

## C0.04 — Credit Tony Aly

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — package metadata, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — planning, legal or CI text, not a composed product journey.

## C0.05 — Describe the `CampDenman` GitHub organization only as the

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — repository-host wording, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — planning, legal or CI text, not a composed product journey.

## C0.06 — Merge the translation-admin branch to `main` and reconcile its

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — a historical merge, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — planning, legal or CI text, not a composed product journey.

## C0.07 — Require CI and DCO on protected `main`, including administrators

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — GitHub branch protection, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — planning, legal or CI text, not a composed product journey.

## C0.08 — Add a plan-consistency gate that rejects references to retired

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — `scripts/plan-gate.mjs` / `pnpm plan:check` names the item and what it owes.
- **F05** — N/A — not an agent capability.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — planning, legal or CI text, not a composed product journey.

## C0.09 — Reconcile `README.md`, setup text, package descriptions, and

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — documentation honesty, not a product surface.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — writes no customer data.
- **F08** — `tests/core/docs-availability.test.ts` — the item's unit/service/database coverage.
- **F09** — `tests/core/docs-availability.test.ts` in CI.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — this item is documentation honesty.

## C0.10 — License all Freeholder-authored code, documentation, deploy

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — license text and SPDX headers, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — reads or writes no customer data.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — `pnpm plan:check` / license / docs gates in CI. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `apache-license.md` named in §43.
- **F12** — changeset `apache-license.md` landed with the rest of the spine. — `scripts/plan-gate.mjs` (the gate this claim is enforced by).

## C0.11 — Audit every checked C-item against the twelve F-criteria, reopen or narrow

- **F01** — N/A — the audit re-verifies existing claims; it adds no schema.
- **F02** — N/A — not a service item; the audited objects are the typed services themselves.
- **F03** — `tests/core/record-participation.test.ts` — contact-merge participation re-checked as part of the audit sample.
- **F04** — N/A — the audit, not a screen.
- **F05** — N/A — not an agent capability; per-row agent surfaces are audited in the F05 column.
- **F06** — N/A — no human surface.
- **F07** — `scripts/plan-gate.mjs` + `tests/core/plan-gate.test.ts` — the missing-proof and resolvable-evidence gates the audit leans on.
- **F08** — `tests/core/f-matrix.test.ts` — the matrix checker suite added by this change, plus the sampled truth audit recorded in this row's §43 annotation.
- **F09** — `scripts/plan-gate.mjs` and `scripts/f-matrix.mjs` run in `pnpm gates`; `pnpm plan:check` in CI.
- **F10** — N/A — no owner/staff/customer UI.
- **F11** — `deploy/f-criteria-matrix.md` (this matrix) + the §43 annotation this row transcribes.
- **F12** — `deploy/f-criteria-matrix.md` composed with `tests/core/f-matrix.test.ts` — every row of the plan audited in one call.

## C0.12 — Extend `plan:check` beyond identifier syntax: checked items must

- **F01** — N/A` are understood, because evidence is written for readers rather than for a regex. It found C3.13 claiming completion while naming neither its agent surface nor its operational story. Two hundred and seventeen items checked before this clause existed sat in an explicit `PROOF_DEBT` set — bounded and visible rather than silent, only ever shrinking. C11.09 emptied it by writing
- **F02** — N/A` are understood, because evidence is written for readers rather than for a regex. It found C3.13 claiming completion while naming neither its agent surface nor its operational story. Two hundred and seventeen items checked before this clause existed sat in an explicit `PROOF_DEBT` set — bounded and visible rather than silent, only ever shrinking. C11.09 emptied it by writing
- **F03** — N/A` are understood, because evidence is written for readers rather than for a regex. It found C3.13 claiming completion while naming neither its agent surface nor its operational story. Two hundred and seventeen items checked before this clause existed sat in an explicit `PROOF_DEBT` set — bounded and visible rather than silent, only ever shrinking. C11.09 emptied it by writing
- **F04** — (or N/A why) beside each; nothing new may join it. — `tests/core/plan-gate.test.ts`.
- **F05** — N/A` are understood, because evidence is written for readers rather than for a regex. It found C3.13 claiming completion while naming neither its agent surface nor its operational story. Two hundred and seventeen items checked before this clause existed sat in an explicit `PROOF_DEBT` set — bounded and visible rather than silent, only ever shrinking. C11.09 emptied it by writing
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — (or N/A why) beside each; nothing new may join it. — `tests/core/plan-gate.test.ts`.
- **F08** — `tests/core/plan-gate.test.ts` — the gate suite proving this class of item; no product test applies.
- **F09** — (or N/A why) beside each; nothing new may join it. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — (or N/A why) beside each; nothing new may join it. — `tests/core/plan-gate.test.ts`.

## C1.01 — Replace coarse roles with named roles and per-module grants

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0017_named-roles-grants.sql`; table invariants asserted in `tests/core/roles.test.ts`.
- **F02** — `tests/core/roles.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/roles.test.ts`.
- **F04** — /admin/roles RoleManager empty/error/destructive. — screen file `app/(admin)/admin/roles/page.tsx`.
- **F05** — `roles.list`/`create`/`update`/`delete`/`assign`/`modules`/`users` at /api/v1/roles.*, OpenAPI/SDK, MCP `roles_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/roles.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/roles.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `named-roles-grants.md` named in §43.
- **F12** — `tests/core/roles.test.ts` is the composition proof.

## C1.02 — Build staff invitations, acceptance, expiry/revocation

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0018_staff-invitations.sql`; table invariants asserted in `tests/core/invitations.test.ts`.
- **F02** — `tests/core/invitations.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/invitations InvitationManager. — screen file `app/(admin)/admin/invitations/page.tsx`.
- **F05** — `invitations.create`/`list`/`revoke`/`resend`/`inspect`/`roles` at /api/v1/invitations.* and OpenAPI/SDK; MCP excludes the `invitations` family (credential issuance). `invitations.accept` is the public HTTP accept path, not a tool. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/invitations.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/invitations.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/invitations.test.ts` is the composition proof.

## C1.03 — Add TOTP/WebAuthn-capable 2FA, recovery codes, mandatory 2FA

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0019_privileged-2fa-step-up.sql`; table invariants asserted in `tests/core/two-factor.test.ts`.
- **F02** — `tests/core/two-factor.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — `/security` TOTP/WebAuthn/recovery and step-up. — `tests/core/two-factor.test.ts`.
- **F05** — `auth.beginTotpEnrollment`/`confirmTotpEnrollment`/`beginWebAuthnRegistration`/`finishWebAuthnRegistration`/`beginWebAuthnStepUp`/`finishWebAuthnStepUp`/`regenerateRecoveryCodes` at /api/v1/auth.* and OpenAPI/SDK; MCP excludes the `auth` family. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/two-factor.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/two-factor.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/two-factor.test.ts` is the composition proof.

## C1.04 — Add owner-visible session/device management, revoke-one

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0020_session-device-management.sql`; table invariants asserted in `tests/core/session-management.test.ts`.
- **F02** — `tests/core/session-management.test.ts` — session device management on the typed identity boundary, with refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — `/security` session/device revoke-one/revoke-all. — `tests/core/session-management.test.ts`.
- **F05** — `auth.listSessions`/`revokeSession`/`revokeOtherSessions`/`recentLoginSecurity` at /api/v1/auth.* and OpenAPI/SDK; MCP excludes `auth`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/session-management.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/session-management.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/session-management.test.ts` is the composition proof.

## C1.05 — Add customer magic links and portal account linking without

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0021_customer-magic-links.sql`; table invariants asserted in `tests/core/customer-magic-links.test.ts`.
- **F02** — `tests/core/customer-magic-links.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/customer-magic-links.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — customer portal magic-link sign-in, not a second contact identity. — `tests/core/customer-magic-links.test.ts`.
- **F05** — `auth.requestCustomerMagicLink`/`consumeCustomerMagicLink` at /api/v1/auth.* plus portal sign-in; MCP excludes `auth`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/customer-magic-links.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/customer-magic-links.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/customer-magic-links.test.ts` is the composition proof.

## C1.06 — Complete organizations, contact tags, owner-defined custom

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0022_contact-data-depth.sql`; table invariants asserted in `tests/core/contact-data-depth.test.ts`.
- **F02** — `tests/core/contact-data-depth.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/contact-data-depth.test.ts`.
- **F04** — /admin/contacts organizations, tags, custom fields, relationships. — screen file `app/(admin)/admin/contacts/page.tsx`.
- **F05** — `contacts.create`/`update`/`list`/`get`/`listTags` plus `contacts.createOrganization`/`listOrganizations` and custom-field/relationship services at /api/v1/contacts.*, OpenAPI/SDK, MCP `contacts_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/contact-data-depth.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/contact-data-depth.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `contact-data-depth.md` named in §43.
- **F12** — `tests/core/contact-data-depth.test.ts` is the composition proof.

## C1.07 — Build duplicate candidate detection/queue, explainable scores

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0023_contact-duplicate-review.sql`; table invariants asserted in `tests/core/contact-duplicate-review.test.ts`.
- **F02** — `tests/core/contact-duplicate-review.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/contact-duplicate-review.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/contacts/duplicates dismiss/merge/undo. — screen file `app/(admin)/admin/contacts/duplicates/page.tsx`.
- **F05** — `contacts.scanDuplicates`/`listDuplicateCandidates`/`dismissDuplicateCandidate`/`mergeDuplicateCandidate`/`merge`/`undoMerge` at /api/v1/contacts.*, MCP `contacts_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/contact-duplicate-review.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/contact-duplicate-review.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contact-duplicate-review.test.ts` is the composition proof.

## C1.08 — Build consent records, preference centre, data-access/export/

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0024_contact-privacy-rights.sql`; table invariants asserted in `tests/core/contact-privacy-rights.test.ts`, `tests/core/merge-completeness.test.ts`.
- **F02** — `tests/core/contact-privacy-rights.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/contact-privacy-rights.test.ts`, `tests/core/merge-completeness.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/contacts/privacy access/export/erasure. — screen file `app/(admin)/admin/contacts/privacy/page.tsx`.
- **F05** — `contacts.createDataRequest`/`fulfillDataRequest`/`recordConsent` and `privacy.getMyProfile`/`createMyDataRequest`/`downloadMyDataRequestArtifact` at /api/v1/contacts.* and /api/v1/privacy.*; MCP `privacy_*`/`contacts_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/contact-privacy-rights.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/contact-privacy-rights.test.ts`, `tests/core/merge-completeness.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/privacy-rights.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contact-privacy-rights.test.ts` is the composition proof.) #### Jobs, events, files, mail, and notifications

## C1.09 — Enqueue jobs inside the caller transaction; add idempotency

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0025_transactional-jobs.sql`; table invariants asserted in `tests/core/transactional-jobs.test.ts`, `tests/core/webhooks.test.ts`.
- **F02** — `tests/core/transactional-jobs.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A as a new screen — F04 is C1.10 /admin/jobs.
- **F05** — N/A as a new agent tool — enqueue is inside the caller transaction; owner/agent job control is C1.10 `platform.listJobs`/`retryJob`.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/transactional-jobs.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/transactional-jobs.test.ts`, `tests/core/webhooks.test.ts`, `tests/core/service-composition.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/background-jobs.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/transactional-jobs.test.ts` is the composition proof.

## C1.10 — Build owner job history, run detail, retry/cancel controls

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/transactional-jobs.test.ts`.
- **F02** — `tests/core/transactional-jobs.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/jobs history, retry, cancel, dead-letter. — screen file `app/(admin)/admin/jobs/page.tsx`.
- **F05** — `platform.listJobs`/`getJob`/`jobSummary`/`listJobQueues`/`cancelJob`/`retryJob`/`redriveDeadLetters` at /api/v1/platform.*, OpenAPI/SDK, MCP `platform_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/transactional-jobs.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/transactional-jobs.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/background-jobs.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `job-operations.md` named in §43.
- **F12** — `tests/core/transactional-jobs.test.ts` is the composition proof.

## C1.11 — Add dead-letter handling for unconsumed or permanently failing

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0026_outbox-dead-letters.sql`, `0028_outbox-state-invariants.sql`; table invariants asserted in `tests/core/outbox.test.ts`, `tests/core/webhooks.test.ts`.
- **F02** — `tests/core/outbox.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/jobs/outbox redacted replay with step-up. — screen file `app/(admin)/admin/jobs/outbox/page.tsx`.
- **F05** — `platform.listOutboxEvents`/`getOutboxEvent`/`replayOutboxEvent`/`outboxSummary` at /api/v1/platform.*, MCP `platform_*` (replay is step-up). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/outbox.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/outbox.test.ts`, `tests/core/webhooks.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/event-outbox.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/outbox.test.ts` is the composition proof.

## C1.12 — Complete media support for video, audio and documents

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0029_closed_rockslide.sql`; table invariants asserted in `tests/core/media.test.ts`.
- **F02** — `tests/core/media.test.ts` — typed media service boundary: validation, quarantine, controlled downloads and refusal assertions against the live registry.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/media upload, trash, restore, purge. — screen file `app/(admin)/admin/media/page.tsx`.
- **F05** — `media.upload`/`beginUpload`/`completeUpload`/`abortUpload`/`trash`/`restore`/`purge` at /api/v1/media.* and /api/media/uploads; OpenAPI/SDK, MCP `media_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/media.test.ts`.
- **F08** — `tests/core/media.test.ts` (46 tests: renditions, asset library, trash/restore/purge) + `tests/core/storage.test.ts` — the focused media/storage coverage the annotation counts.
- **F09** — operator runbook `deploy/media-lifecycle.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `media-lifecycle.md` named in §43.
- **F12** — changeset `media-lifecycle.md` landed with the rest of the spine. — `tests/core/media.test.ts`.

## C1.13 — Add generated image alt-text suggestions with explicit human

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0030_tired_northstar.sql`; table invariants asserted in `tests/core/alt-text-adapter.test.ts`.
- **F02** — `tests/core/alt-text-adapter.test.ts` — the proposal/review ledger service enforced (human-only provider calls, stale-write protection, refusal).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/media alt-text proposal review. — screen file `app/(admin)/admin/media/page.tsx`.
- **F05** — `media.generateAltTextSuggestion`/`listAltTextSuggestionStates`/`acceptAltTextSuggestion`/`applyAltTextSuggestion` at /api/v1/media.* and SDK; provider generation is MCP-opted-out, accept/apply stay on HTTP/SDK. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/alt-text-adapter.test.ts`.
- **F08** — `tests/core/alt-text-adapter.test.ts` — the 74 focused adapter/media/doctor/MCP tests the annotation counts.
- **F09** — operator runbook `deploy/alt-text-suggestions.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `alt-text-suggestions.md` named in §43.
- **F12** — changeset `alt-text-suggestions.md` landed with the rest of the spine. — `tests/core/alt-text-adapter.test.ts`.

## C1.14 — Complete Gmail and Microsoft transactional OAuth adapters

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0031_lucky_maria_hill.sql`; table invariants asserted in `tests/core/mail-service.test.ts`.
- **F02** — `tests/core/mail-service.test.ts` + `tests/core/mail-adapters.test.ts` — typed OAuth/SMTP/broadcast adapter boundary, sender verification and suppression-state refusals.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/settings mail connect/verify/pause/test. — screen file `app/(admin)/admin/settings/page.tsx`.
- **F05** — `mail.beginOAuth`/`status`/`registerSender`/`verifySender`/`testSend`/`setDefaultSender` at /api/v1/mail.*, MCP `mail_*`; OAuth callback is /api/mail/oauth/[provider]/callback (not a tool). Feedback webhooks at /api/mail/webhooks/{postmark,resend,ses}. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/mail-service.test.ts`.
- **F08** — `tests/core/mail-service.test.ts`, `tests/core/mail-adapters.test.ts`, `tests/core/mail-oauth.test.ts`, `tests/core/mail-webhooks.test.ts` — the focused mail adapter coverage.
- **F09** — operator runbook `deploy/mail-delivery.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `mail-adapter-completion.md` named in §43.
- **F12** — changeset `mail-adapter-completion.md` landed with the rest of the spine. — `tests/core/mail-service.test.ts`.

## C1.15 — Build the notification fanout model and inbox: in-app, email

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0032_fancy_namora.sql`, `0033_thin_lady_bullseye.sql`; table invariants asserted in `tests/core/notifications.test.ts`.
- **F02** — `tests/core/notifications.test.ts` — notification fanout service: system-only creation, per-topic preference and refusal assertions.
- **F03** — `tests/core/notifications.test.ts` — contact-owned notification state repoints through a reversible merge.
- **F04** — /admin/notifications bell, queue and preferences. — screen file `app/(admin)/admin/notifications/page.tsx`.
- **F05** — `notifications.list`/`markRead`/`preferences`/`updateSettings`/`registerDevice` at /api/v1/notifications.*, MCP `notifications_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/notifications.test.ts`.
- **F08** — `tests/core/notifications.test.ts` + `tests/core/notification-ui.test.ts` — fanout model, inbox, digest and escalation coverage.
- **F09** — operator runbook `deploy/notification-fanout.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `notification-fanout-inbox.md` named in §43.
- **F12** — changeset `notification-fanout-inbox.md` landed with the rest of the spine.) #### International, analytics, security, and quality. — `tests/core/notifications.test.ts`.

## C1.16 — Finish translated site chrome and all customer-facing locale

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0034_furry_ozymandias.sql`, `0035_slim_wiccan.sql`; table invariants asserted in `tests/core/customer-locale.test.ts`, `tests/core/customer-locale-ui.test.ts`.
- **F02** — `tests/core/customer-locale.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/customer-magic-links.test.ts`, `tests/core/notifications.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — public chrome and customer portal locale, not a new admin screen. — `tests/core/customer-locale.test.ts`.
- **F05** — `i18n.getMyLocale`/`setMyLocale`/`setTranslation`/`listTranslations` at /api/v1/i18n.*, MCP `i18n_*`; contact locale is `contacts.update`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/customer-locale.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/customer-locale.test.ts`, `tests/core/customer-locale-ui.test.ts`, `tests/core/customer-magic-links.test.ts` — the item's unit/service/database coverage (+2 more cited in §43).
- **F09** — operator runbook `deploy/customer-locales.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `locale-driven-customer-surfaces.md` named in §43.
- **F12** — `tests/core/customer-locale.test.ts` is the composition proof.

## C1.17 — Complete and continuously verify English, French and Spanish

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/i18n-gate.test.ts`.
- **F02** — N/A — a catalog-completeness gate, not a typed service; the catalogs it guards are exercised in `tests/core/i18n-gate.test.ts`.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A as a screen — `tests/core/i18n-gate.test.ts` is the human-surface gate.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — a catalog-completeness gate with no customer-data surface; it refuses missing keys and unexecutable catalogs (`tests/core/i18n-gate.test.ts`).
- **F08** — `tests/core/i18n-gate.test.ts`, `tests/core/locale-quality.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `catalog-quality-rtl.md` named in §43.
- **F12** — `tests/core/i18n-gate.test.ts` — every shipped catalog parses and formats against the default locale.

## C1.18 — Add analytics consent policy, configurable retention/pruning

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0036_milky_radioactive_man.sql`; table invariants asserted in `tests/core/analytics.test.ts`, `tests/core/analytics-consent.test.ts`.
- **F02** — `tests/core/analytics.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/traffic consent and retention. — screen file `app/(admin)/admin/traffic/page.tsx`.
- **F05** — `analytics.track`/`identify`/`overview`/`exportAnonymized`/`webVitals` at /api/v1/analytics.*, MCP `analytics_*`; public beacons are /api/analytics/consent and /api/analytics/vitals. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/analytics.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/analytics.test.ts`, `tests/core/analytics-consent.test.ts`, `tests/core/analytics-governance-migration.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/analytics-governance.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `analytics-governance.md` named in §43.
- **F12** — `tests/core/analytics.test.ts` is the composition proof.

## C1.19 — Add a Content Security Policy compatible with editor preview

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0037_tidy_thunderbolts.sql`; table invariants asserted in `tests/core/csp.test.ts`, `tests/core/csp-reports.test.ts`.
- **F02** — `tests/core/csp.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — Content-Security-Policy headers, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/csp.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/csp.test.ts`, `tests/core/csp-reports.test.ts`, `tests/core/csp-migration.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/content-security-policy.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `content-security-policy.md` named in §43.
- **F12** — `tests/core/csp.test.ts` is the composition proof.

## C1.20 — Patch all actionable dependency advisories and keep a zero

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/dependency-audit.test.ts`.
- **F02** — N/A — a dependency-audit policy gate, not a typed product service.
- **F03** — N/A — no contact, money or audit surface; the ledger it writes is the exception JSON, not the spine.
- **F04** — N/A — dependency audit CI, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — a CI policy gate, not a customer-data threat model.
- **F08** — `tests/core/dependency-audit.test.ts` — advisory floors, unwaivable high/critical policy and exception-ledger expiry asserted.
- **F09** — `scripts/dependency-audit.mjs` in CI and `SECURITY.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `dependency-security-policy.md` named in §43.
- **F12** — N/A — lockfile policy, not a composed product journey.

## C1.21 — Replace simulated public accessibility checks with real-browser

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/browser/accessibility.spec.ts`.
- **F02** — `tests/browser/accessibility.spec.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A as a new screen — real-browser axe on existing journeys.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/browser/accessibility.spec.ts` covers permission, refusal and recovery.
- **F08** — `tests/browser/accessibility.spec.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/accessibility-testing.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/browser/accessibility.spec.ts` is the composition proof.

## C1.22 — Add Playwright-style browser journeys for setup, auth, editing

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/browser/journeys.spec.ts`.
- **F02** — `tests/browser/journeys.spec.ts` — the narrow 2FA-bridging identity services are exercised through the real browser login journey (wrong-password, password-plus-factor, recovery codes).
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/browser/journeys.spec.ts`.
- **F04** — N/A as a new screen — Playwright journeys over existing setup/auth/edit.
- **F05** — N/A as a new capability — the journey already mints an API key and calls POST /api/mcp `contacts_list`; no extra agent route.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/browser/journeys.spec.ts` proves refusal and recovery through the real browser; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/browser/journeys.spec.ts` — one serial production-Chromium story across setup, auth, editing, publishing, forms, contacts, translations, API keys, MCP and recovery.
- **F09** — operator runbook `deploy/browser-journeys.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/browser/journeys.spec.ts` is the composition proof.

## C1.23 — Add database backup/restore drills, complete export, media

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/ownership-export.test.ts`.
- **F02** — `tests/core/ownership-export.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — backup/restore drill, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/ownership-export.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/ownership-export.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/ownership-recovery.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/ownership-export.test.ts` is the composition proof.

## C1.24 — Make a fresh development/demo install serve a complete seeded

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/seed-demo.test.ts`.
- **F02** — N/A — install-time seeding behaviour, not a service contract.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — setup wizard demo install, not a new admin screen. — `tests/core/seed-demo.test.ts`.
- **F05** — `demo.install` and `seed.installPreset` at /api/v1/demo.install and /api/v1/seed.installPreset, MCP `demo_install`/`seed_installPreset`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/seed-demo.test.ts`.
- **F08** — `tests/core/seed-demo.test.ts` — pristine-database auto-install, in-progress refusal and explicit blank-setup preservation.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `seeded-development-home.md` named in §43.
- **F12** — changeset `seeded-development-home.md` landed with the rest of the spine. — `tests/core/seed-demo.test.ts`.

## C1.25 — Build resumable, role/capability-derived onboarding for owner

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0040_curved_purple_man.sql`; table invariants asserted in `tests/core/guidance-definitions.test.ts`, `tests/core/guidance-ui.test.ts`, `tests/core/guidance.test.ts`.
- **F02** — `tests/core/guidance.test.ts` — capability-derived task activation and permission refusal on the guidance service.
- **F03** — `tests/core/guidance.test.ts` — per-user progress is contact/user-owned and reconciliation is outcome-based.
- **F04** — /admin/guidance resumable onboarding. — screen file `app/(admin)/admin/guidance/page.tsx`.
- **F05** — `guidance.list`/`start`/`dismiss`/`reset`/`contexts` at /api/v1/guidance.*, MCP `guidance_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/guidance-definitions.test.ts`, `tests/core/guidance-ui.test.ts`, `tests/core/guidance.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/guidance.test.ts` + `tests/core/guidance-ui.test.ts` + `tests/core/guidance-definitions.test.ts` — the `guidance*` suite the annotation cites.
- **F09** — operator runbook `deploy/role-guidance.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `role-guidance.md` named in §43.
- **F12** — `tests/core/guidance-definitions.test.ts`, `tests/core/guidance-ui.test.ts`, `tests/core/guidance.test.ts` is the composition proof.

## C1.26 — Build the normalized, versioned `DemoScenario` definition/run/

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0041_red_zeigeist.sql`, `0042_worthless_naoko.sql`; table invariants asserted in `tests/core/demo-scenarios.test.ts`.
- **F02** — `tests/core/demo-scenarios.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/demo-scenarios.test.ts`.
- **F04** — /admin/demos load/reload/reset/purge. — screen file `app/(admin)/admin/demos/page.tsx`.
- **F05** — `demo.list`/`load`/`reload`/`reset`/`purge` at /api/v1/demo.*, MCP `demo_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/demo-scenarios.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/demo-scenarios.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/demo-scenarios.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/demo-scenarios.test.ts` is the composition proof.

## C1.27 — After the required C5–C9 domain modules exist, ship complete

- **F01** — no new tables — provenance is still `demo_records`. — `tests/core/demo-scenarios.test.ts`.
- **F02** — per-module load/purge/verify handlers behind `requireDemoHandlerRun`. — `tests/core/demo-scenarios.test.ts`.
- **F03** — contacts go through `contacts.resolve`; merge already covers the owned tables. — `tests/core/demo-scenarios.test.ts`.
- **F04** — /admin/demos lists all five scenarios with outcome links. — screen file `app/(admin)/admin/demos/page.tsx`.
- **F05** — `demo.load` is the same service HTTP/MCP already expose. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/demo-scenarios.test.ts` plus the existing Chromium lifecycle.
- **F08** — `tests/core/demo-scenarios.test.ts` — the item's unit/service/database coverage.
- **F09** — Apache-2.0 SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `deploy/demo-scenarios.md` and `seed/README.md`. Changeset `complete-demo-scenarios.md`.

## C1.28 — Make screen/window/tab, camera and microphone recording a

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/media-capture.test.ts`.
- **F02** — `tests/core/media-capture.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/media/record camera/microphone capture. — screen file `app/(admin)/admin/media/record/page.tsx`.
- **F05** — `media.appendCaptureChunk`/`assembleCapture`/`applyCaptureComplete` at /api/v1/media.*, MCP `media_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/media-capture.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/media-capture.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `media-capture-review.md` named in §43.
- **F12** — `tests/core/media-capture.test.ts` is the composition proof.

## C1.29 — Make phone ingest require no app: QR and expiring upload-link

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/media-capture.test.ts`.
- **F02** — `tests/core/media-capture.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — public capture link `/capture/[token]`, not a second app. — `tests/core/media-capture.test.ts`.
- **F05** — public `/capture/[token]` plus `media.completeUpload`/`registerStoredOriginal` at /api/v1/media.*; the token page is not an MCP tool. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/media-capture.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/media-capture.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `media-phone-ingest.md` named in §43.
- **F12** — `tests/core/media-capture.test.ts` is the composition proof.

## C1.30 — Model and services for the contribution channel: kinds, local

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0068_careless_jack_power.sql`; table invariants asserted in `tests/core/contribute.test.ts`.
- **F02** — `tests/core/contribute.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/contribute.test.ts`.
- **F04** — N/A as a screen — F04 is C1.31 /admin/contribute.
- **F05** — `contribute.draft`/`submit`/`list`/`get`/`attach` at /api/v1/contribute.* (C1.32 is the MCP/HTTP parity item). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/contribute.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/contribute.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/contribute.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `contribute-channel.md` named in §43.
- **F12** — `tests/core/contribute.test.ts` is the composition proof.

## C1.31 — Human surfaces: spoke compose/history, hub inbox/determination

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/contribute.test.ts`.
- **F02** — `tests/core/contribute.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/contribute compose, history, determination. — screen file `app/(admin)/admin/contribute/page.tsx`.
- **F05** — `contribute.ingest`/`triage`/`determine`/`list`/`get` at /api/v1/contribute.*; public `/contribute` is the human form, not a second contract. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/contribute.test.ts`.
- **F08** — `tests/core/contribute.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contribute.test.ts` is the composition proof.

## C1.32 — Agent and delivery: MCP/HTTP parity from the registry; deliver

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/contribute.test.ts`.
- **F02** — `tests/core/contribute.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A as a new screen — MCP/HTTP parity of C1.31.
- **F05** — this item *is* the agent surface — `contribute.*` at /api/v1/contribute.* and MCP `contribute_*`; hub POST is the `contribute.deliver` job, not a second catalogue. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/contribute.test.ts`.
- **F08** — `tests/core/contribute.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contribute.test.ts` is the composition proof.

## C1.33 — Code submissions: patch/diff/PR URL, DCO attestation, license

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/contribute.test.ts`.
- **F02** — `tests/core/contribute.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/contribute code-submission kind. — screen file `app/(admin)/admin/contribute/page.tsx`.
- **F05** — `contribute.submit` with the code-submission kind at /api/v1/contribute.submit, MCP `contribute_submit` (never auto-merge). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/contribute.test.ts`.
- **F08** — `tests/core/contribute.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contribute.test.ts` is the composition proof.

## C1.34 — Reply hub determinations to the speaking instance: store a

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0069_colossal_maria_hill.sql`; table invariants asserted in `tests/core/contribute.test.ts`.
- **F02** — `tests/core/contribute.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/contribute determination reply. — screen file `app/(admin)/admin/contribute/page.tsx`.
- **F05** — `contribute.setHubEnabled`/`recordStatus` at /api/v1/contribute.*, MCP `contribute_setHubEnabled`/`contribute_recordStatus`; spoke apply is the `contribute.reply` job. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/contribute.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/contribute.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contribute.test.ts` is the composition proof.

## C1.35 — Close outbound-request SSRF completely: resolve every webhook

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/webhooks.test.ts`.
- **F02** — `tests/core/webhooks.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — webhook destination pinning, not a screen.
- **F05** — N/A — destination pinning lives under `webhooks.create`/`test`/`replay` transport, not a new tool.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/webhooks.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/webhooks.test.ts`, `tests/core/social-http.test.ts`, `tests/core/outbound-boundaries.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/webhook-delivery.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/webhooks.test.ts` is the composition proof.

## C1.36 — Make required background work operationally truthful: expose

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/job-runtime-health.test.ts`.
- **F02** — N/A — operational truthfulness work on the job runtime, not a customer-facing service contract.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/health Doctor runtime evidence. — screen file `app/(admin)/admin/health/page.tsx`.
- **F05** — `platform.doctor` at /api/v1/platform.doctor, MCP `platform_doctor`, plus public /api/health and /api/health/live (liveness is not an MCP tool). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/job-runtime-health.test.ts`.
- **F08** — `tests/core/job-runtime-health.test.ts` + `tests/core/runtime-shutdown.test.ts` — heartbeat, queue-lag, liveness/readiness split and drain-on-shutdown.
- **F09** — operator runbook `deploy/background-jobs.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — Doctor health is the operational composition proof. — `tests/core/job-runtime-health.test.ts`.

## C1.37 — Make supply-chain and release provenance enforceable: split and

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/dependency-attestation.test.ts`.
- **F02** — N/A — CI/release provenance policy, not a product service.
- **F03** — N/A — no spine touchpoint; the evidence is pipeline configuration and attestations.
- **F04** — N/A — supply-chain provenance CI, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — CI provenance, not a customer-data threat model.
- **F08** — `tests/core/dependency-attestation.test.ts` — lockfile-keyed audit evidence and exact-digest promotion policy.
- **F09** — operator runbook `deploy/ci-release-gate.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — N/A — CI/SBOM policy, not a composed product journey.

## C1.38 — Disposable public playground

- **F01** — Existing users, roles and sessions; no additional tenant schema. `src/core/demo/playground.ts` initializes only a disposable database.
- **F02** — `src/core/demo/playground.ts` defines the entry contract; `src/core/demo/playground-policy.ts` explicitly lists editing mutations.
- **F03** — Uses the ordinary unified contact services; no separate demo contact model. `src/core/contacts/service.ts`.
- **F04** — `app/playground/page.tsx` and the shared root banner; actual container entry is exercised by `scripts/playground-gate.sh`.
- **F05** — Browser-only entry is deliberately excluded from external API/MCP projections; `tests/core/internal-services.test.ts`.
- **F06** — Entry/banner strings in all four locale catalogs; shared semantic tokens. `locales/en.json`, `src/core/design/tokens.ts`.
- **F07** — `tests/core/playground.test.ts` proves edits, privilege refusal and opt-in isolation; the container gate checks blocked egress.
- **F08** — `tests/core/playground.test.ts`; `scripts/playground-gate.sh` exercises the built artifact.
- **F09** — Disposable data and files reset hourly; no personal information belongs here. `deploy/docker-selfhost/playground/reset.sh`.
- **F10** — Existing published sample content is installed at boot, with a persistent shared-data/reset notice. `src/modules/seed/boot.ts`, `app/layout.tsx`.
- **F11** — `deploy/docker-selfhost/playground/README.md`; full live reset/browser proof remains required before closing the item.
- **F12** — Entry through a real session and page edit use the ordinary services; `tests/core/playground.test.ts`.

## C2.01 — Separate working drafts from published revisions for every

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-lifecycle.test.ts`.
- **F02** — `tests/core/cms-lifecycle.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] working draft vs published. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — `cms.updatePage`/`publishPage` at /api/v1/cms.updatePage and /api/v1/cms.publishPage, MCP `cms_updatePage`/`cms_publishPage`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-lifecycle.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-lifecycle.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-content-lifecycle.md` named in §43.
- **F12** — `tests/core/cms-lifecycle.test.ts` is the composition proof.

## C2.02 — Add preview links, scheduled publish/unpublish, approval state

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-lifecycle.test.ts`.
- **F02** — `tests/core/cms-lifecycle.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] preview, schedule, approval. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — `cms.createPreviewLink`/`schedulePage`/`requestApproval`/`compareRevisions`/`snapshotRevision`/`restoreRevision`/`listRevisions` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-lifecycle.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-lifecycle.test.ts`, `tests/core/cms-history.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-author-history.md` named in §43.
- **F12** — `tests/core/cms-lifecycle.test.ts` is the composition proof.

## C2.03 — Add optimistic concurrency/version tokens, presence, edit

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-lifecycle.test.ts`.
- **F02** — `tests/core/cms-lifecycle.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] presence and edit lease. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — `cms.updatePage` version tokens plus `cms.heartbeatPresence`/`listPresence`/`leavePresence` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-lifecycle.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-lifecycle.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-collab-presence-comments.md` named in §43.
- **F12** — `tests/core/cms-lifecycle.test.ts` is the composition proof.

## C2.04 — Add comments, mentions, review requests and resolved threads

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-lifecycle.test.ts`.
- **F02** — `tests/core/cms-lifecycle.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] comments and review requests. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — `cms.addComment`/`listComments`/`resolveThread`/`requestReview`/`decideReview` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-lifecycle.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-lifecycle.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-collab-presence-comments.md` named in §43.
- **F12** — `tests/core/cms-lifecycle.test.ts` is the composition proof.

## C2.05 — Specify and implement constrained typed rich-text inline nodes

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-rich.test.ts`.
- **F02** — `tests/core/cms-rich.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] PageEditor rich text. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — N/A as a distinct tool — typed inline nodes persist through `cms.updatePage` at /api/v1/cms.updatePage / MCP `cms_updatePage`.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-rich.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-rich.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-rich-editor-foundations.md` named in §43.
- **F12** — `tests/core/cms-rich.test.ts` is the composition proof.

## C2.06 — Add slash-command insertion, keyboard block movement, undo/

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-rich.test.ts`.
- **F02** — `tests/core/cms-rich.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] slash-command and keyboard movement. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — N/A as a distinct tool — slash-command/keyboard/undo are editor chrome; the page is still `cms.updatePage`.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-rich.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-rich.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-rich-editor-foundations.md` named in §43.
- **F12** — `tests/core/cms-rich.test.ts` is the composition proof.) #### Complete block and design vocabulary

## C2.07 — Finish foundational blocks: rich text, heading, image, video

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-rich.test.ts`.
- **F02** — `tests/core/cms-rich.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] foundational blocks. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — foundational blocks persist through `cms.updatePage`; the custom-HTML sanitizer is not an MCP tool. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-rich.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-rich.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/cms-rich.test.ts` is the composition proof.

## C2.08 — Finish trust/content blocks: FAQ with schema, testimonial/

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-blocks.test.ts`.
- **F02** — `tests/core/cms-blocks.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] FAQ/testimonial blocks. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — FAQ/testimonial/gallery/map/share blocks persist through `cms.updatePage` at /api/v1/cms.updatePage, MCP `cms_updatePage`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-blocks.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-blocks.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-surface-blocks.md` named in §43.
- **F12** — `tests/core/cms-blocks.test.ts` is the composition proof.

## C2.09 — Finish conversion blocks: live product/service card, booking

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-blocks.test.ts`.
- **F02** — `tests/core/cms-blocks.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] conversion blocks. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — conversion blocks persist through `cms.updatePage`; public submit paths are `cms.submitQuoteRequest`/`cms.submitSiteChat`/`cms.submitTipIntent`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-blocks.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-blocks.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-surface-blocks.md` named in §43.
- **F12** — `tests/core/cms-blocks.test.ts` is the composition proof.

## C2.10 — Finish controlled-access/revenue blocks: paywall gate and ad

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-blocks.test.ts`.
- **F02** — `tests/core/cms-blocks.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] paywall/ad blocks. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — paywall/ad blocks persist through `cms.updatePage`; evaluation is `paywalls.evaluate` / `ads.slotByCode` (C9.15/C9.17). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-blocks.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-blocks.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-surface-blocks.md` named in §43.
- **F12** — `tests/core/cms-blocks.test.ts` is the composition proof.

## C2.11 — Make headers, footers, navigation, announcement bars and menus

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-sections.test.ts`.
- **F02** — `tests/core/cms-sections.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/sections header/footer/nav/announcement. — screen file `app/(admin)/admin/sections/page.tsx`.
- **F05** — `cms.createSection`/`listSections`/`updateSection`/`getSection` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-sections.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-sections.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-chrome-sections.md` named in §43.
- **F12** — `tests/core/cms-sections.test.ts` is the composition proof.

## C2.12 — Support save-as-Section, synced instances, detach-to-copy

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-sections.test.ts`.
- **F02** — `tests/core/cms-sections.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/sections save-as-section and detach. — screen file `app/(admin)/admin/sections/page.tsx`.
- **F05** — `cms.saveAsSection`/`detachSection`/`deleteSection` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-sections.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-sections.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-section-instances.md` named in §43.
- **F12** — `tests/core/cms-sections.test.ts` is the composition proof.

## C2.13 — Build page/post/product/service/email templates and per-business

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-templates.test.ts`.
- **F02** — `tests/core/cms-templates.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/templates page/email templates. — screen file `app/(admin)/admin/templates/page.tsx`.
- **F05** — `cms.listTemplates`/`updateTemplate`/`resetTemplate`/`createFromTemplate`/`previewTemplate`/`ensureTemplates` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-templates.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-templates.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-templates.md` named in §43.
- **F12** — `tests/core/cms-templates.test.ts` is the composition proof.

## C2.14 — Add per-entity layout overrides and clean detach/rejoin behavior

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-layouts.test.ts`.
- **F02** — `tests/core/cms-layouts.test.ts` — section/layout mutations through the typed CMS service with validation and refusal.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages/[id] layout detach/rejoin. — screen file `app/(admin)/admin/pages/[id]/page.tsx`.
- **F05** — `cms.attachLayout`/`detachLayout`/`rejoinLayout`/`getLayout` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-layouts.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-layouts.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-entity-layouts.md` named in §43.
- **F12** — `tests/core/cms-layouts.test.ts` is the composition proof.

## C2.15 — Build visual design controls over semantic tokens: colors

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/design-tokens.test.ts`.
- **F02** — `tests/core/design-tokens.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/design-tokens.test.ts`.
- **F04** — /admin/design semantic tokens. — screen file `app/(admin)/admin/design/page.tsx`.
- **F05** — `settings.getDesign`/`updateDesign`/`resetDesign` at /api/v1/settings.*, MCP `settings_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/design-tokens.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/design-tokens.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-design-tokens.md` named in §43.
- **F12** — `tests/core/design-tokens.test.ts` is the composition proof.

## C2.16 — Support locale-aware content workflow, side-by-side source/

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-translation-workflow.test.ts`.
- **F02** — `tests/core/cms-translation-workflow.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/translations side-by-side workflow. — screen file `app/(admin)/admin/translations/page.tsx`.
- **F05** — `cms.draftPageTranslation`/`pageTranslationReport` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-translation-workflow.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-translation-workflow.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-locale-workflow.md` named in §43.
- **F12** — `tests/core/cms-translation-workflow.test.ts` is the composition proof.) #### Experiments, email, SEO, and performance

## C2.17 — Add variants to blocks, Sections, pages and entity layouts

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-experiments.test.ts`.
- **F02** — `tests/core/cms-experiments.test.ts` — variant persistence and sticky assignment through the typed CMS service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/experiments variants. — screen file `app/(admin)/admin/experiments/page.tsx`.
- **F05** — experiment/variant blocks persist through `cms.updatePage`; sticky assignment is server-side, not a separate MCP family. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-experiments.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-experiments.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/cms-experiments.test.ts` is the composition proof.

## C2.18 — Record experiment impressions/conversions and join outcomes to

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/analytics-experiments.test.ts`.
- **F02** — `tests/core/analytics-experiments.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/analytics-experiments.test.ts`.
- **F04** — /admin/experiments impressions. — screen file `app/(admin)/admin/experiments/page.tsx`.
- **F05** — `analytics.recordExperimentImpressions`/`recordExperimentConversion`/`experimentReport` at /api/v1/analytics.*, MCP `analytics_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/analytics-experiments.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/analytics-experiments.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/analytics-experiments.test.ts` is the composition proof.

## C2.19 — Reuse the block editor for email-safe output with restricted

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-email.test.ts`.
- **F02** — `tests/core/cms-email.test.ts` — transactional email templates on the typed CMS boundary with stable errors.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages empty/error/recovery. — screen file `app/(admin)/admin/pages/page.tsx`.
- **F05** — `cms.previewEmail`/`testSendEmail` at /api/v1/cms.previewEmail and /api/v1/cms.testSendEmail, MCP `cms_previewEmail`/`cms_testSendEmail`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-email.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-email.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-email-editor.md` named in §43.
- **F12** — `tests/core/cms-email.test.ts` is the composition proof.

## C2.20 — Enforce one H1, heading order, semantic landmarks, required alt

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-a11y.test.ts`.
- **F02** — `tests/core/cms-a11y.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/cms-a11y.test.ts`.
- **F04** — N/A as a new screen — editor a11y of C2.05–C2.10.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — publish refuses 0 or 2+ H1s. — `tests/core/cms-a11y.test.ts`.
- **F08** — `tests/core/cms-a11y.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A — heading order is not a backup/export record. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-a11y-hints.md` named in §43.
- **F12** — `tests/core/cms-a11y.test.ts` is the composition proof.

## C2.21 — Generate OG images, IndexNow notifications and product/location/

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/seo-surface.test.ts`.
- **F02** — `tests/core/seo-surface.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/builder prompt-to-proposal. — screen file `app/(admin)/admin/builder/page.tsx`.
- **F05** — public `/og`, `/feeds/[kind]`, `/indexnow-key` plus `seo.submitIndexNow` at /api/v1/seo.submitIndexNow, MCP `seo_submitIndexNow`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/seo-surface.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/seo-surface.test.ts`, `tests/core/seo-public-entities.test.ts`, `tests/core/catalog-public-pages.test.ts` — the item's unit/service/database coverage (+2 more cited in §43).
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `events-newsletters-seo.md` named in §43.
- **F12** — `tests/core/seo-surface.test.ts` is the composition proof.

## C2.22 — Add draft/published cache invalidation, image and page budgets

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/cms-cache.test.ts`.
- **F02** — `tests/core/cms-cache.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/builder apply/rollback proposal. — screen file `app/(admin)/admin/builder/page.tsx`.
- **F05** — N/A as a new tool — cache bust and page/image budgets run inside `cms.publishPage`/`cms.updatePage`.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/cms-cache.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/cms-cache.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-cache-budgets.md` named in §43.
- **F12** — `tests/core/cms-cache.test.ts` is the composition proof.

## C2.23 — Prove a plugin can register a schema, renderer, editor fields

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0073_plain_lilandra.sql`; table invariants asserted in `tests/core/cms-plugin-proof.test.ts`.
- **F02** — `tests/core/cms-plugin-proof.test.ts` — plugin-provided CMS fields render through the typed host contract.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — editor performance budgets, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/cms-plugin-proof.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/cms-plugin-proof.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cms-plugin-proof.md` named in §43.
- **F12** — `tests/core/cms-plugin-proof.test.ts` is the composition proof.

## C3.01 — Add required output schemas to every service and validate

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/service-output.test.ts`.
- **F02** — `tests/core/service-output.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/service-output.test.ts`.
- **F04** — N/A — service contract shape, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — a schema-completeness gate, not a customer-data threat model.
- **F08** — `tests/core/service-output.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A — output schemas are not operational records. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `service-output-schemas.md` named in §43.
- **F12** — `tests/core/service-output.test.ts` is the completeness proof.

## C3.02 — Generate complete OpenAPI request, success, error, auth and

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/contract-projections.test.ts`.
- **F02** — `tests/core/contract-projections.test.ts` — registry-derived projections keep the typed contract stable.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — HTTP /api/v1 OpenAPI, not a new admin screen. — `tests/core/contract-projections.test.ts`.
- **F05** — this item *is* GET /api/openapi.json documenting every /api/v1/{service} path. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/contract-projections.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/contract-projections.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contract-projections.test.ts` is the composition proof.

## C3.03 — Generate and test `@freeholder/sdk` types/client from the live

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/sdk.test.ts`.
- **F02** — `tests/core/sdk.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — generated SDK, not a screen.
- **F05** — this item *is* `@freeholder/sdk` generated from that OpenAPI; no extra routes. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/sdk.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/sdk.test.ts`, `tests/core/sdk-schema.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/sdk.test.ts` is the composition proof.

## C3.04 — Make MCP discovery actor-aware—including actor kind, service

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/mcp.test.ts`.
- **F02** — `tests/core/mcp.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/settings API keys. — screen file `app/(admin)/admin/settings/page.tsx`.
- **F05** — POST /api/mcp tools/list is actor-filtered; `apikeys.create`/`list`/`revoke`/`scopes` stay HTTP/SDK (/api/v1/apikeys.*) because MCP excludes the `apikeys` family. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/mcp.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/mcp.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/mcp.test.ts` is the composition proof.

## C3.05 — Complete MCP resources/prompts and supported transport/session

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/mcp.test.ts`.
- **F02** — `tests/core/mcp.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — MCP /api/mcp, not a new admin screen. — `tests/core/mcp.test.ts`.
- **F05** — POST /api/mcp `resources/list|read` on `freeholder://contract/*` and `prompts/list|get`; session header only, no second registry. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/mcp.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/mcp.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/mcp.test.ts` is the composition proof.

## C3.06 — Generate human reference docs and `llms.txt` contract sections

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/contract-projections.test.ts`.
- **F02** — `tests/core/contract-projections.test.ts` — the OpenAPI/SDK projection round-trips against the registry.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/settings webhooks create/pause/test. — screen file `app/(admin)/admin/settings/page.tsx`.
- **F05** — GET /llms.txt and GET /llms-full.txt are the human/LLM projection of the same registry. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/contract-projections.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/contract-projections.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contract-projections.test.ts` is the composition proof.

## C3.07 — Add webhook subscriptions, delivery inspection/replay, schema

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/webhooks.test.ts`.
- **F02** — `tests/core/webhooks.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/settings webhook inspect/replay (C11.09 F04). — screen file `app/(admin)/admin/settings/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `webhooks.create`/`list`/`update`/`remove`/`test`/`inspectDelivery`/`replay`/`rotateEndpoint`/`rotateSecret` at /api/v1/webhooks.*, MCP `webhooks_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/webhooks.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/webhooks.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/webhooks.test.ts` is the composition proof.) #### Plugin system and registries

## C3.08 — Finalize plugin manifest/version/capability contracts, module

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/plugin-contract.test.ts`.
- **F02** — `tests/core/plugin-contract.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — plugin contract, not a screen.
- **F05** — N/A as an instance agent tool — `@freeholder/plugin-kit` `definePlugin` contract; plugin services join /api/v1 and MCP only after install (C3.09).
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/plugin-contract.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/plugin-contract.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/plugin-contract.test.ts` is the composition proof.

## C3.09 — Implement install, enable, disable, update and uninstall with

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/plugins-lifecycle.test.ts`.
- **F02** — `tests/core/plugins-lifecycle.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/plugins install/enable/disable/uninstall. — screen file `app/(admin)/admin/plugins/page.tsx`.
- **F05** — `plugins.install`/`enable`/`disable`/`update`/`rollback`/`uninstall`/`list`/`get` at /api/v1/plugins.*, MCP `plugins_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/plugins-lifecycle.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/plugins-lifecycle.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/plugins-lifecycle.test.ts` is the composition proof.

## C3.10 — Enforce plugin boundaries and failure isolation so a bad plugin

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/plugins-lifecycle.test.ts`.
- **F02** — `tests/core/plugins-lifecycle.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/plugins update/rollback (C11.09 F04). — screen file `app/(admin)/admin/plugins/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — isolation is boot-time; the operator tool is `plugins.disable` at /api/v1/plugins.disable, MCP `plugins_disable`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/plugins-lifecycle.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/plugins-lifecycle.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/plugins-lifecycle.test.ts` is the composition proof.

## C3.11 — Build local/community/verified/private registries, signed

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/plugins-lifecycle.test.ts`.
- **F02** — `tests/core/plugins-lifecycle.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/plugins registries and catalogue (C11.09 F04). — screen file `app/(admin)/admin/plugins/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `plugins.addRegistry`/`listRegistries`/`cacheRegistry`/`listCatalog` at /api/v1/plugins.*, MCP `plugins_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/plugins-lifecycle.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/plugins-lifecycle.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/plugins-lifecycle.test.ts` is the composition proof.

## C3.12 — Ship plugin scaffolding, dev harness, fixture instance, contract

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/plugin-scaffold.test.ts`.
- **F02** — `tests/core/plugin-scaffold.test.ts` — the scaffolded plugin compiles against the typed authoring contract.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/imports start/preview/commit. — screen file `app/(admin)/admin/imports/page.tsx`.
- **F05** — N/A — `packages/plugin-kit` scaffold/dev harness and `tests/fixtures/sample-plugin`, not an HTTP/MCP route.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/plugin-scaffold.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/plugin-scaffold.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/plugin-scaffold.test.ts` is the composition proof.

## C3.13 — Ship first-party plugins for gift options/registries, print-on-

- **F01** — `plugins/community/schema.ts`, `plugins/gift-registry/schema.ts`, `plugins/marketplace/schema.ts`, `plugins/print-on-demand/schema.ts`, `plugins/voice-video/schema.ts` — plugin tables fold through `db/migrations/0000_reviewed-baseline.sql` and the on-disk post-collapse migrations 0001–0004.
- **F02** — `tests/core/plugin-contract.test.ts` + the per-plugin suites (`tests/core/community-rooms.test.ts`, `tests/core/printify-fulfillment.test.ts`, `tests/core/marketplace-claims.test.ts`, `tests/core/daily-flow.test.ts`, `tests/core/product-gift-share.test.ts`).
- **F03** — `tests/core/plugin-claims.test.ts` — gift contributions and marketplace orders land on invoices through `contacts.resolve`.
- **F04** — `tests/browser/first-party-plugins.spec.ts` — admin screens plus `/gifts/<slug>` and `/community/<slug>` in the real browser.
- **F05** — the §43 annotation names the surfaced services (`community.getFeedBySlug`, `printOnDemand.submit`, `marketplace.sync`, `voiceVideo.*`); derivation equivalence is `tests/core/api.test.ts`.
- **F06** — Host catalog gates `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts`; no per-item scan claimed.
- **F07** — `tests/core/plugin-provider-boundary.test.ts` — fixture adapters refuse outside `NODE_ENV=test` (the audit repair); the Printify live adapter shipped with `tests/core/printify-fulfillment.test.ts`, owner-side live acceptance pending.
- **F08** — the per-plugin suites + `tests/core/plugins-lifecycle.test.ts` + `tests/core/plugin-provider-boundary.test.ts`.
- **F09** — retry-in-place evidence in the per-plugin suites; retention/erasure ride the host seams (C11.14, `tests/core/record-participation.test.ts`).
- **F10** — N/A — plugins ride the host demo; no plugin-specific seed claimed.
- **F11** — `deploy/spec-reconciliation.md` + the §43 annotation this row transcribes.
- **F12** — Open — `tests/browser/first-party-plugins.spec.ts` passes for every plugin; the box stays open for owner-side live acceptance of the Printify/channel adapters.

## C3.14 — Implement `create-freeholder` with explicit environment checks

- **F01** — N/A — installer CLI, no schema/services/spine/HTTP.
- **F02** — N/A — installer CLI, no schema/services/spine/HTTP.
- **F03** — N/A — installer CLI, no schema/services/spine/HTTP.
- **F04** — CLI empty/error/recovery: missing `.env`, incomplete keys, migrate refusal, unreachable setup URL. — `tests/core/create-freeholder.test.ts`.
- **F05** — N/A — installer CLI, no schema/services/spine/HTTP.
- **F06** — N/A — terminal installer.
- **F07** — existing unsafe-target refusals; migrate blocked until `DATABASE_URL`; recovery names the fix. — `tests/core/create-freeholder.test.ts`.
- **F08** — `tests/core/create-freeholder.test.ts`; tarball exercise in `scripts/package-artifact-gate.mjs`.
- **F09** — N/A — no jobs; Doctor remains after owner claim. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — `--demo`, `GETTING_STARTED.md`, printed setup URL. — `tests/core/create-freeholder.test.ts`.
- **F11** — MASTER §22/§43, package README, changeset `create-freeholder-setup.md`. — `tests/core/create-freeholder.test.ts`.
- **F12** — env → install → migrate → setup URL with an injected runner; packed tarball in the package artifact gate. — `tests/core/create-freeholder.test.ts`.

## C3.15 — Turn `@freeholder/templates` into tested business presets using

- **F01** — N/A — no new tables; existing CMS/catalog/forms rows.
- **F02** — N/A — no new tables; existing CMS/catalog/forms rows.
- **F03** — N/A — no new tables; existing CMS/catalog/forms rows.
- **F04** — N/A as a new screen — the CMS template list already shows seeded letters.
- **F05** — `seed.installPreset` on HTTP/MCP. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — seed copy is English starter text the owner replaces.
- **F07** — unknown preset refused; existing slugs/forms skipped. — `tests/core/templates.test.ts`.
- **F08** — `tests/core/templates.test.ts` and `tests/core/cms-templates.test.ts`.
- **F09** — N/A. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — `--preset` plus `seed.installPreset`. — `tests/core/templates.test.ts`.
- **F11** — package README, MASTER §32/§43, changeset `business-presets.md`. — `tests/core/templates.test.ts`.
- **F12** — creator/service/shop install yields pages, a catalog entity and a slotted email template. — `tests/core/templates.test.ts`.

## C3.16 — Provide working recipes for Replit, DigitalOcean App Platform

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/recipes.test.ts`.
- **F02** — `tests/core/recipes.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — `packages/cli` doctor/migrate, not a new admin screen. — `tests/core/recipes.test.ts`.
- **F05** — N/A — IaC recipes (`replit.nix`, `render.yaml`, compose, DO/Railway); operator CLI is C10.21.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/recipes.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/recipes.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/recipes.test.ts` is the composition proof.

## C3.17 — Give every Tier-1 recipe install, verify, backup, restore

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/recipes.test.ts`.
- **F02** — `tests/core/recipes.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — versioned platform contract, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/recipes.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/recipes.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/migration-runbook.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/recipes.test.ts` is the composition proof.

## C3.18 — Build one-command full export of normalized data, media manifest

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/ownership-export.test.ts`.
- **F02** — `tests/core/ownership-export.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/health Doctor checks. — screen file `app/(admin)/admin/health/page.tsx`.
- **F05** — `platform.export` at /api/v1/platform.export, MCP `platform_export`, plus `pnpm ownership:export` CLI. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/ownership-export.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/ownership-export.test.ts`, `tests/core/portability.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/ownership-export.test.ts` is the composition proof.

## C3.19 — Prove round-trip migration between every Tier-1 pair while

- **F01** — N/A — no schema; portability proves the existing schema round-trips.
- **F02** — `tests/core/portability.test.ts` — dump/restore round-trip preserving IDs, money, timestamps and locales through the service layer.
- **F03** — `tests/core/portability.test.ts` — contact-owned records survive the round-trip on the spine.
- **F04** — N/A — adapter conformance tests, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/portability.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/portability.test.ts` + `scripts/ownership-drill.mjs` — the Tier-1 pair round-trip drill the item specifies.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/portability.test.ts` is the composition proof.

## C3.20 — Add semantic platform/plugin/API versions, compatibility

- **F01** — N/A — versions live in package manifests (`packages/sdk/package.json` stamps `PLATFORM_VERSION`) and generated artifacts, not the database schema.
- **F02** — `tests/core/release-packages.test.ts` — the tag/version matching boundary refuses mismatched publishes.
- **F03** — N/A — no contact, money or audit surface.
- **F04** — admin header shows the version. — `tests/core/release-packages.test.ts`.
- **F05** — health/OpenAPI/SDK. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — `admin.platformVersion` in en/es/fr. — `tests/core/release-packages.test.ts`.
- **F07** — tag mismatch and missing `NPM_TOKEN` refuse publish. — `tests/core/release-packages.test.ts`.
- **F08** — `tests/core/release-packages.test.ts`.
- **F09** — N/A — no jobs or storage; publishing is a CI step (`scripts/release-packages.mjs`).
- **F10** — N/A — no setup or demo surface of its own.
- **F11** — `deploy/README.md` + `packages/README.md` + changeset `versioned-release.md`.
- **F12** — `scripts/package-artifact-gate.mjs` — `pnpm packages:verify` asserts aligned versions on packed tarballs.

## C3.21 — Define the importer plugin contract and kit: typed source/auth

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/importers.test.ts`.
- **F02** — `tests/core/importers.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/imports map/review-conflicts. — screen file `app/(admin)/admin/imports/page.tsx`.
- **F05** — N/A as a new HTTP family — `defineImporter` in plugin-kit; owner runs go through `imports.*` (C3.23).
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/importers.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/importers.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/importers.test.ts` is the composition proof.

## C3.22 — Ship complete first-party WordPress REST/WXR and generic-site

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/importers.test.ts`.
- **F02** — `tests/core/importers.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — first-party plugin seam, not a new screen.
- **F05** — parsers sit behind `imports.start`/`previewFromSource` at /api/v1/imports.*, MCP `imports_*`; no extra importer family. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/importers.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/importers.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/importers.test.ts` is the composition proof.

## C3.23 — Build the owner import studio and resumable run ledger

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/plugins-lifecycle.test.ts`.
- **F02** — `tests/core/plugins-lifecycle.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — federated registry signature, not a screen.
- **F05** — `imports.start`/`preview`/`map`/`reviewConflicts`/`commit`/`reconcile`/`publish`/`rollback`/`list` at /api/v1/imports.*, MCP `imports_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/plugins-lifecycle.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/plugins-lifecycle.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/plugins-lifecycle.test.ts` is the composition proof.

## C4.01 — Build the work board, task tree/dependency view, assignment

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/agents-board.test.ts`.
- **F02** — `tests/core/agents-board.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work agent hire/connect. — screen file `app/(admin)/admin/work/page.tsx`.
- **F05** — `agents.board`/`updateTask`/`flagTask`/`reopenTask`/`createTask`/`assignTask` at /api/v1/agents.*, MCP `agents_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-board.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-board.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-board.test.ts` is the composition proof.

## C4.02 — Build live run streaming, redacted step inspection, retry

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/agents-run.test.ts`.
- **F02** — `tests/core/agents-run.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work tasks/runs. — screen file `app/(admin)/admin/work/page.tsx`.
- **F05** — `agents.inspectRun`/`tailRun`/`stopRun`/`retryTask` at /api/v1/agents.*, MCP `agents_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-run.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-run.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-run.test.ts` is the composition proof.

## C4.03 — Enforce suggest/approve/autonomous behavior for every managed

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0077_agent_approval_autonomy.sql`; table invariants asserted in `tests/core/agents-autonomy.test.ts`.
- **F02** — `tests/core/agents-autonomy.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work/approvals approval inbox. — screen file `app/(admin)/admin/work/approvals/page.tsx`.
- **F05** — `agents.proposeWrite`/`listApprovals` at /api/v1/agents.*, MCP `agents_*` (writes queue; suggest never escalates). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-autonomy.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-autonomy.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-autonomy.test.ts` is the composition proof.

## C4.04 — Build approval inbox, expiry, rejection notes, step-up auth

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/agents-approvals.test.ts`.
- **F02** — `tests/core/agents-approvals.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work/spend budgets. — screen file `app/(admin)/admin/work/spend/page.tsx`.
- **F05** — `agents.approveWrite`/`rejectWrite`/`expireApprovals` at /api/v1/agents.*, MCP `agents_*` (step-up + human-only on decisions). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-approvals.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-approvals.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-approvals.test.ts` is the composition proof.

## C4.05 — Implement the managed-agent adapter family, provider/model

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/agents-workforce-adapter.test.ts`.
- **F02** — `tests/core/agents-workforce-adapter.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work pause/kill. — screen file `app/(admin)/admin/work/page.tsx`.
- **F05** — `agents.connect`/`claimTask`/`reportStep`/`completeTask` at /api/v1/agents.*; the managed loop's tool surface is `mcp/tools.toolsFor` (same catalogue). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-workforce-adapter.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-workforce-adapter.test.ts`, `tests/core/agents-managed-loop.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-workforce-adapter.test.ts` is the composition proof.

## C4.06 — Enforce per-run/task/agent/period budgets before every step

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0078_agent_model_prices.sql`; table invariants asserted in `tests/core/agents-budgets.test.ts`.
- **F02** — `tests/core/agents-budgets.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work/playbooks playbook export/run. — screen file `app/(admin)/admin/work/playbooks/page.tsx`.
- **F05** — `agents.spend` at /api/v1/agents.spend, MCP `agents_spend` (the budget topic is a notification, not a second API). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-budgets.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-budgets.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-budgets.test.ts` is the composition proof.

## C4.07 — Add per-agent pause and global kill switch that prevent new

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/agents-pause.test.ts`.
- **F02** — `tests/core/agents-pause.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — untrusted-input markers, not a new screen.
- **F05** — `agents.pause`/`pauseAll` at /api/v1/agents.pause and /api/v1/agents.pauseAll, MCP `agents_pause`/`agents_pauseAll`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/agents-pause.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-pause.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-pause.test.ts` is the composition proof.

## C4.08 — Complete playbooks with parameter schemas, manual/event/schedule

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0079_agent_playbook_versions.sql`; table invariants asserted in `tests/core/agents-playbooks.test.ts`.
- **F02** — `tests/core/agents-playbooks.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — `app/(admin)/admin/work/playbooks/page.tsx` — playbook writing/running/enabling/deleting/importing in EN/FR/ES (annotation's calendar route was a copy-paste error, corrected by the C0.11 audit).
- **F05** — `agents.createPlaybook`/`exportPlaybook`/`importPlaybook`/`deletePlaybook` at /api/v1/agents.* for humans/SDK; playbook authoring is hidden from MCP. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-playbooks.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-playbooks.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-playbooks.test.ts` is the composition proof.

## C4.09 — Harden untrusted-input envelopes, indirect prompt-injection

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/agents-injection.test.ts`.
- **F02** — `tests/core/agents-injection.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/agents-injection.test.ts`.
- **F04** — /admin/inbox mail-read begin-OAuth (C11.09 F04). — screen file `app/(admin)/admin/inbox/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — N/A as a new tool — this item *removes* playbook authoring from MCP and fences untrusted input on existing `agents_*` tools.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-injection.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-injection.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-injection.test.ts` is the composition proof.) #### Connected accounts and recurring work

## C4.10 — Complete credential-key rotation, backup/recovery documentation

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0080_agent_connection_grants.sql`; table invariants asserted in `tests/core/connection-grants.test.ts`.
- **F02** — `tests/core/connection-grants.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/calendar busy/writeback. — screen file `app/(admin)/admin/calendar/page.tsx`.
- **F05** — `connections.rotateCredentials`/`grantToAgent`/`revokeFromAgent`/`mine` at /api/v1/connections.*, MCP `connections_*` (grant is step-up/human-only). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/connection-grants.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/connection-grants.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/ownership-recovery.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/connection-grants.test.ts` is the composition proof.

## C4.11 — Implement Google and Microsoft OAuth with incremental calendar

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0081_connection_oauth_purpose.sql`; table invariants asserted in `tests/core/calendar-oauth.test.ts`.
- **F02** — `tests/core/calendar-oauth.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work inbound agent claim. — screen file `app/(admin)/admin/work/page.tsx`.
- **F05** — `connections.beginCalendarOAuth` at /api/v1/connections.beginCalendarOAuth, MCP `connections_beginCalendarOAuth`; callback /api/connections/calendar/[provider]/callback is not a tool. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/calendar-oauth.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/calendar-oauth.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/calendar-oauth.test.ts` is the composition proof.

## C4.12 — Sync external calendars with tokens, busy-only default

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/calendar-sync.test.ts`.
- **F02** — `tests/core/calendar-sync.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — credential encryption, not a screen.
- **F05** — sync is `core.syncExternalCalendars` (system, hidden from MCP/HTTP); owner query is `connections.calendarSources` at /api/v1/connections.calendarSources. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/calendar-sync.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/calendar-sync.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/calendar-sync.test.ts` is the composition proof.

## C4.13 — Build unified calendar display and connect busy unions to the

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/calendar-busy.test.ts`.
- **F02** — `tests/core/calendar-busy.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/calendar-busy.test.ts`.
- **F04** — /admin/health connection doctor. — screen file `app/(admin)/admin/health/page.tsx`.
- **F05** — `connections.busyWindows` at /api/v1/connections.busyWindows, MCP `connections_busyWindows` (shape is `{startsAt,endsAt}` only). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/calendar-busy.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/calendar-busy.test.ts`, `tests/core/zoned.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/calendar-busy.test.ts` is the composition proof.

## C4.14 — Implement runtime playbook scheduling with timezone/DST

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/agents-schedule.test.ts`.
- **F02** — `tests/core/agents-schedule.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/briefing daily briefing. — screen file `app/(admin)/admin/briefing/page.tsx`.
- **F05** — `agents.setPlaybookSchedule` at /api/v1/agents.setPlaybookSchedule, MCP `agents_setPlaybookSchedule`; `agents.runDuePlaybooks` is the system tick (hidden). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/agents-schedule.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/agents-schedule.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/agents-schedule.test.ts` is the composition proof.

## C4.15 — Build briefing entities, contributor registry, preassembly

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0083_briefings.sql`; table invariants asserted in `tests/core/briefing.test.ts`.
- **F02** — `tests/core/briefing.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/briefing.test.ts`.
- **F04** — /admin/work scheduled playbooks. — screen file `app/(admin)/admin/work/page.tsx`.
- **F05** — `briefing.today`/`assemble`/`markRead`/`recent`/`setSection` at /api/v1/briefing.*, MCP `briefing_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/briefing.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/briefing.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/briefing.test.ts` is the composition proof.

## C4.16 — Add core briefing contributors for appointments, enquiries

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/briefing-contributors.test.ts`.
- **F02** — `tests/core/briefing-contributors.test.ts` — briefing contributors assemble through the typed service boundary.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/briefing-contributors.test.ts`.
- **F04** — N/A — agent isolation, not a screen.
- **F05** — core contributors feed `briefing.assemble`; no extra HTTP family beyond C4.15 `briefing_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/briefing-contributors.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/briefing-contributors.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/briefing-contributors.test.ts` is the composition proof.

## C4.17 — Add playbook/module contributions plus email, SMS and push

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/briefing-playbooks.test.ts`.
- **F02** — `tests/core/briefing-playbooks.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work live run. — screen file `app/(admin)/admin/work/page.tsx`.
- **F05** — `briefing.playbookSection`/`setSection` at /api/v1/briefing.playbookSection and /api/v1/briefing.setSection, MCP `briefing_playbookSection`/`briefing_setSection`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/briefing-playbooks.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/briefing-playbooks.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/briefing-playbooks.test.ts` is the composition proof.

## C4.18 — Add Gmail/Microsoft mail read and contact import as untrusted

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/mail-import.test.ts`.
- **F02** — `tests/core/mail-import.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/mail-import.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — N/A — autonomy write classes, not a new screen.
- **F05** — `connections.beginMailReadOAuth` at /api/v1/connections.beginMailReadOAuth, MCP `connections_beginMailReadOAuth`; callback /api/connections/mail-read/[provider]/callback. Import is `core.importConnectedMail` (system). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/mail-import.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/mail-import.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/mail-import.test.ts` is the composition proof.) #### Owner-facing self-builder

## C4.19 — Implement the content lane: owner brief → scoped proposal →

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/builder-content-lane.test.ts`.
- **F02** — `tests/core/builder-content-lane.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/work catalogue of tools. — screen file `app/(admin)/admin/work/page.tsx`.
- **F05** — `builder.propose`/`listProposals`/`getProposal`/`apply`/`reject`/`rollback`/`status` at /api/v1/builder.*, MCP `builder_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/builder-content-lane.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/builder-content-lane.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/builder-content-lane.test.ts` is the composition proof.

## C4.20 — Implement the code lane: isolated worktree, budget/permission

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0088_builder_code_lane.sql`; table invariants asserted in `tests/core/builder-code-lane.test.ts`.
- **F02** — `tests/core/builder-code-lane.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — injection hardening, not a screen.
- **F05** — `builder.proposeCode`/`deliverCode`/`rejectCode`/`listCodeProposals`/`getCodeProposal`/`codeStatus` at /api/v1/builder.*, MCP `builder_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/builder-code-lane.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/builder-code-lane.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/builder-code-lane.test.ts` is the composition proof.

## C4.21 — Keep `builder

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/builder-authority.test.ts`.
- **F02** — `tests/core/builder-authority.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/builder-authority.test.ts`.
- **F04** — /admin/inbox conversations. — screen file `app/(admin)/admin/inbox/page.tsx`.
- **F05** — N/A as a new family — `builder.*` stays a separately granted module from `agents.*` on the same /api/v1 and MCP catalogue.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/builder-authority.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/builder-authority.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/builder-authority.test.ts` is the composition proof.

## C4.22 — Expose the builder safely through admin, API and MCP and emit

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/builder-authority.test.ts`.
- **F02** — `tests/core/builder-authority.test.ts` — builder verbs dispatch under the same typed permission checks as every other service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/calendar begin-OAuth (C11.09 F04). — screen file `app/(admin)/admin/calendar/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `builder.*` plus `platform.source` at /api/v1/builder.* and /api/v1/platform.source, MCP `builder_*`/`platform_source`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/builder-authority.test.ts`.
- **F08** — `tests/core/builder-authority.test.ts` + `tests/core/builder-code-lane.test.ts` — source/audit provenance and code-lane coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — calendar OAuth is the same begin/callback path as mail-read. — `tests/core/builder-authority.test.ts`.

## C4.23 — Add a federated catalogue for shareable agent/playbook

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0089_catalogue.sql`; table invariants asserted in `tests/core/catalogue.test.ts`.
- **F02** — `tests/core/catalogue.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalogue.test.ts`.
- **F04** — N/A as a new screen — catalogue install reuses `agents.importPlaybook` on /admin/work/playbooks.
- **F05** — `catalogue.list`/`preview`/`install`/`sources` at /api/v1/catalogue.*, MCP `catalogue_*`; install reuses `agents.importPlaybook`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/catalogue.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalogue.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/catalogue.test.ts` is the composition proof.

## C5.01 — Land `none` plus real adapter contracts for payments, tax

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/edge-adapters.test.ts`.
- **F02** — `tests/core/edge-adapters.test.ts` — the adapter contract suite: capability discovery, honest disabled adapters and hostile-input refusal.
- **F03** — N/A — adapter seams for external edges; no contact/money records of their own (money convergence happens at the payment items).
- **F04** — /admin/invoices draft/issue/void. — screen file `app/(admin)/admin/invoices/page.tsx`.
- **F05** — N/A as a new HTTP family — `none` plus adapter contracts are used by `invoicing.*` (C5.05–C5.08); no agent calls an adapter directly.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/edge-adapters.test.ts`.
- **F08** — `tests/core/edge-adapters.test.ts` — the six-test contract/hostile suite the annotation names.
- **F09** — operator runbook `deploy/edge-adapters.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-edge-contracts.md` named in §43.
- **F12** — changeset `commerce-edge-contracts.md` landed with the rest of the spine. — `tests/core/edge-adapters.test.ts`.

## C5.02 — Implement tax zones and most-specific matching, categories

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0043_worried_shaman.sql`, `0044_nervous_maelstrom.sql`; table invariants asserted in `tests/core/money-arithmetic.test.ts`, `tests/core/invoicing.test.ts`.
- **F02** — `tests/core/money-arithmetic.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/money-arithmetic.test.ts`.
- **F04** — /admin/invoices tax evidence. — screen file `app/(admin)/admin/invoices/page.tsx`.
- **F05** — `invoicing.addTaxRate` and tax-zone services at /api/v1/invoicing.*, MCP `invoicing_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/money-arithmetic.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/money-arithmetic.test.ts`, `tests/core/invoicing.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/commerce-money.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/money-arithmetic.test.ts` is the composition proof.

## C5.03 — Implement exemptions, reverse charge, shipping tax, rounding

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0045_peaceful_puck.sql`; table invariants asserted in `tests/core/invoicing.test.ts`.
- **F02** — `tests/core/invoicing.test.ts` — exemption enforcement and immutable TaxLine snapshot behaviour on the typed invoicing service.
- **F03** — `tests/core/invoicing.test.ts` — tax and exemption state is contact-owned; merge-undo integration asserted.
- **F04** — /admin/payments record/refund. — screen file `app/(admin)/admin/payments/page.tsx`.
- **F05** — exemption/reverse-charge/shipping-tax services at /api/v1/invoicing.*, MCP `invoicing_*` (same family as C5.02, different verbs). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/invoicing.test.ts`.
- **F08** — `tests/core/invoicing.test.ts` + `tests/core/tax-templates.test.ts` — calculation explanations and template coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-money-foundation.md` named in §43.
- **F12** — changeset `commerce-money-foundation.md` landed with the rest of the spine. — `tests/core/invoicing.test.ts`.

## C5.04 — Ship and verify Canada, EU, UK, US, Australia and New Zealand

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/money-arithmetic.test.ts`.
- **F02** — `tests/core/money-arithmetic.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/money-arithmetic.test.ts`.
- **F04** — /admin/invoices credits. — screen file `app/(admin)/admin/invoices/page.tsx`.
- **F05** — N/A as a new route — CA/EU/UK/US/AU/NZ templates seed `invoicing.addTaxRate`; not a separate MCP family.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/money-arithmetic.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/money-arithmetic.test.ts`, `tests/core/invoicing.test.ts`, `tests/core/tax-templates.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-tax-templates.md` named in §43.
- **F12** — `tests/core/money-arithmetic.test.ts` is the composition proof.

## C5.05 — Implement invoice/line/payment/refund/credit-note state machines

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0043_worried_shaman.sql`, `0045_peaceful_puck.sql`; table invariants asserted in `tests/core/invoicing.test.ts`.
- **F02** — `tests/core/invoicing.test.ts` — quote/invoice state machines on the typed money boundary with stable errors.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/invoicing.test.ts`.
- **F04** — `/portal` customer invoice view. — `tests/core/invoicing.test.ts`.
- **F05** — `invoicing.createDraft`/`issue`/`void`/`issueCreditNote`/`listPayments` at /api/v1/invoicing.*, MCP `invoicing_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/invoicing.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/invoicing.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/invoicing.test.ts` is the composition proof.

## C5.06 — Implement manual/offline, Stripe and PayPal payment adapters

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0046_right_swordsman.sql`; table invariants asserted in `tests/core/payment-adapters.test.ts`.
- **F02** — `tests/core/payment-adapters.test.ts` — one typed adapter contract exercised across manual/Stripe/PayPal with signature, idempotency and overpay refusal.
- **F03** — `tests/core/payment-adapters.test.ts` — payments converge on the invoice spine transactionally.
- **F04** — /admin/invoices/tax zones/rates. — screen file `app/(admin)/admin/invoices/tax/page.tsx`.
- **F05** — `invoicing.beginPaymentCheckout`/`completePaymentCheckout`/`recordOfflinePayment` at /api/v1/invoicing.*, MCP `invoicing_*`; Stripe/PayPal feedback is /api/payments/webhooks/stripe and /api/payments/webhooks/paypal (not MCP). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/payment-adapters.test.ts`.
- **F08** — `tests/core/payment-adapters.test.ts` — the adapter contract suite the item names.
- **F09** — operator runbook `deploy/commerce-payments.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-payment-providers.md` named in §43.
- **F12** — changeset `commerce-payment-providers.md` landed with the rest of the spine. — `tests/core/payment-adapters.test.ts`.

## C5.07 — Implement Square, Mollie, Razorpay and Paystack/Flutterwave

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/payment-adapters.test.ts`.
- **F02** — `tests/core/payment-adapters.test.ts` — Square/Mollie/Razorpay/Paystack/Flutterwave behind the identical contract and contract tests.
- **F03** — N/A — same spine convergence as C5.06; no new spine surface of its own.
- **F04** — /admin/invoices/recurring schedules. — screen file `app/(admin)/admin/invoices/recurring/page.tsx`.
- **F05** — same invoicing checkout services as C5.06; Square/Mollie/Razorpay/Paystack/Flutterwave webhooks at /api/payments/webhooks/{square,mollie,razorpay,paystack,flutterwave}. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/payment-adapters.test.ts`.
- **F08** — `tests/core/payment-adapters.test.ts` — the shared contract suite.
- **F09** — operator runbook `deploy/commerce-payments.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-provider-parity.md` named in §43.
- **F12** — changeset `commerce-provider-parity.md` landed with the rest of the spine. — `tests/core/payment-adapters.test.ts`.

## C5.08 — Support deposits, balances, payment plans, tips, pay-what-you-

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0047_fantastic_miss_america.sql`; table invariants asserted in `tests/core/advanced-money.test.ts`.
- **F02** — `tests/core/advanced-money.test.ts` — deposits, payment plans and late fees through the typed invoicing boundary.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/advanced-money.test.ts`.
- **F04** — /admin/invoices/[id] payment plan/late fee; /admin/invoices/new deposit/balance; /admin/payments payouts (C11.09 F04). — screen files `app/(admin)/admin/invoices/[id]/page.tsx`, `app/(admin)/admin/invoices/new/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `invoicing.createDepositAndBalance`/`createPaymentPlan`/`assessLateFee`/`adjustCustomerBalance`/`recordProviderPayout` at /api/v1/invoicing.*, MCP `invoicing_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/advanced-money.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/advanced-money.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/commerce-money.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/advanced-money.test.ts` is the composition proof.

## C5.09 — Build product lifecycle for physical, digital, service

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0048_marvelous_morg.sql`; table invariants asserted in `tests/core/catalog.test.ts`.
- **F02** — `tests/core/catalog.test.ts` — the six-kind lifecycle service: kind lock, archive/restore transitions and refusal.
- **F03** — N/A — catalog lifecycle events ride the existing product spine; merge/audit behaviour proven in the catalog suites.
- **F04** — /admin/pos in-person collection. — screen file `app/(admin)/admin/pos/page.tsx`.
- **F05** — `catalog.createProduct`/`updateProduct`/`activateProduct`/`publishProduct`/`archiveProduct`/`restoreProduct` at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/catalog.test.ts`.
- **F08** — `tests/core/catalog.test.ts` + `tests/core/catalog-variants.test.ts` — lifecycle and variant coverage.
- **F09** — operator runbook `deploy/commerce-catalog.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-product-lifecycle.md` named in §43.
- **F12** — changeset `commerce-product-lifecycle.md` landed with the rest of the spine. — `tests/core/catalog.test.ts`.

## C5.10 — Build option types/values, reusable dimensions, generated

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0049_blue_naoko.sql`; table invariants asserted in `tests/core/catalog-variants.test.ts`.
- **F02** — `tests/core/catalog-variants.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalog-variants.test.ts`.
- **F04** — /admin/products catalog. — screen file `app/(admin)/admin/products/page.tsx`.
- **F05** — `catalog.createOptionType`/`addOptionValue`/`applyVariantMatrix`/`getProductVariants` at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-variants.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-variants.test.ts` — the item's unit/service/database coverage.
- **F09** — operator runbook `deploy/commerce-catalog.md`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-variant-matrices.md` named in §43.
- **F12** — `tests/core/catalog-variants.test.ts` is the composition proof.

## C5.11 — Build attributes/filtering/comparison, unlimited ordered media

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0050_classy_colleen_wing.sql`; table invariants asserted in `tests/core/catalog-merchandising.test.ts`.
- **F02** — `tests/core/catalog-merchandising.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalog-merchandising.test.ts`.
- **F04** — /admin/products/[id] variants. — screen file `app/(admin)/admin/products/[id]/page.tsx`.
- **F05** — `catalog.setProductAttribute`/`filterProductsByAttribute`/`compareProducts`/`attachProductMedia` at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-merchandising.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-merchandising.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/catalog-merchandising.test.ts` is the composition proof.

## C5.12 — Build product relations, bundle components, upsell/cross-sell/

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0051_absent_miracleman.sql`; table invariants asserted in `tests/core/catalog-relations.test.ts`.
- **F02** — `tests/core/catalog-relations.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/inventory stock. — screen file `app/(admin)/admin/inventory/page.tsx`.
- **F05** — relation/bundle/upsell services at /api/v1/catalog.*, MCP `catalog_*` (same family as C5.09–C5.11, relation verbs). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-relations.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-relations.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/catalog-relations.test.ts` is the composition proof.

## C5.13 — Build price lists, entries, audiences, customer groups

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/catalog-pricing.test.ts`.
- **F02** — `tests/core/catalog-pricing.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalog-pricing.test.ts`.
- **F04** — /admin/shipping zones. — screen file `app/(admin)/admin/shipping/page.tsx`.
- **F05** — price-list/audience services at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-pricing.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-pricing.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/catalog-pricing.test.ts` is the composition proof.

## C5.14 — Implement tiered and volume price breaks plus one deterministic

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/price-breaks.test.ts`.
- **F02** — `tests/core/price-breaks.test.ts` — typed-contract coverage with validation and refusal assertions; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/carts saved carts. — screen file `app/(admin)/admin/carts/page.tsx`.
- **F05** — `catalog.resolvePrice` plus price-break services at /api/v1/catalog.resolvePrice, MCP `catalog_resolvePrice`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/price-breaks.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/price-breaks.test.ts`, `tests/core/catalog-pricing.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/price-breaks.test.ts` is the composition proof.

## C5.15 — Complete service offerings, deposits, policies, forms, waivers

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0052_mysterious_talon.sql`; table invariants asserted in `tests/core/catalog-offerings.test.ts`.
- **F02** — `tests/core/catalog-offerings.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalog-offerings.test.ts`.
- **F04** — /admin/orders checkout. — screen file `app/(admin)/admin/orders/page.tsx`.
- **F05** — service-offering/deposit/waiver services at /api/v1/catalog.*, MCP `catalog_*`; intake forms stay `forms.*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-offerings.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-offerings.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-service-offerings.md` named in §43.
- **F12** — `tests/core/catalog-offerings.test.ts` is the composition proof.

## C5.16 — Implement append-only stock movements, multi-location balances

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0053_high_richard_fisk.sql`; table invariants asserted in `tests/core/catalog-inventory.test.ts`.
- **F02** — `tests/core/catalog-inventory.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/fulfillment shipments. — screen file `app/(admin)/admin/fulfillment/page.tsx`.
- **F05** — `catalog.recordStockMovement`/`adjustStock`/`transferStock`/`listInventory`/`listStockMovements` at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-inventory.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-inventory.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-inventory-ledger.md` named in §43.
- **F12** — `tests/core/catalog-inventory.test.ts` is the composition proof.

## C5.17 — Implement safety/reorder levels, incoming stock, backorders

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0054_ancient_steel_serpent.sql`; table invariants asserted in `tests/core/catalog-procurement.test.ts`.
- **F02** — `tests/core/catalog-procurement.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalog-procurement.test.ts`.
- **F04** — /admin/returns RMAs. — screen file `app/(admin)/admin/returns/page.tsx`.
- **F05** — `catalog.reserveStock`/`expireReservations`/`availability`/`listReservations` at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-procurement.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-procurement.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/catalog-procurement.test.ts` is the composition proof.

## C5.18 — Implement shipping zones, deterministic rate engine, packaging

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0055_puzzling_toad.sql`; table invariants asserted in `tests/core/shipping-quote.test.ts`.
- **F02** — `tests/core/shipping-quote.test.ts` — the deterministic rate engine boundary across zone/weight/dimensional quotes.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/promotions coupons. — screen file `app/(admin)/admin/promotions/page.tsx`.
- **F05** — `catalog.createShippingZone`/`quoteShipping`/`listShippingCatalog`/`addShippingRateBand` at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/shipping-quote.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/shipping-quote.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/shipping-quote.test.ts` is the composition proof.

## C5.19 — Implement shipments, split fulfillment, tracking, digital

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0057_rare_gladiator.sql`; table invariants asserted in `tests/core/catalog-fulfillment.test.ts`.
- **F02** — `tests/core/catalog-fulfillment.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalog-fulfillment.test.ts`.
- **F04** — /admin/price-lists price lists. — screen file `app/(admin)/admin/price-lists/page.tsx`.
- **F05** — `catalog.createFulfillment`/`shipFulfillment`/`grantDigitalFulfillment`/`requestReturn`/`listFulfillments` at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-fulfillment.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-fulfillment.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-fulfillment.md` named in §43.
- **F12** — `tests/core/catalog-fulfillment.test.ts` is the composition proof.

## C5.20 — Build persistent/contact-attached carts, saved carts/wishlists

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0056_flippant_snowbird.sql`; table invariants asserted in `tests/core/catalog-carts.test.ts`, `tests/core/cart-access.test.ts`.
- **F02** — `tests/core/catalog-carts.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalog-carts.test.ts`.
- **F04** — /admin/carts list and detail, with role-gated management controls. — screen file `app/(admin)/admin/carts/page.tsx`.
- **F05** — `catalog.addCartItem`/`attachCartToContact`/`addWishlistItem`/`checkoutCart` at /api/v1/catalog.*, MCP `catalog_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-carts.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-carts.test.ts`, `tests/core/cart-access.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `cart-capability-authorization.md` named in §43.
- **F12** — `tests/core/catalog-carts.test.ts` is the composition proof.

## C5.21 — Build checkout identity/address, fulfillment, tax, discounts

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/catalog-carts.test.ts`.
- **F02** — `tests/core/catalog-carts.test.ts` — `catalog.checkoutCart` typed boundary: acceptedTerms, idempotency, retry and refusal.
- **F03** — `tests/core/catalog-carts.test.ts` — order+invoice created in one transaction on the contact spine.
- **F04** — N/A — money integer arithmetic, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — N/A — integer arithmetic, not a customer-data threat model.
- **F08** — `tests/core/catalog-carts.test.ts` — checkout identity/address/payment recovery coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — integer money arithmetic is the shared path, not a silo. — `tests/core/catalog-carts.test.ts`.

## C5.22 — Build order lifecycle, mixed physical/digital/service lines

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0056_flippant_snowbird.sql`; table invariants asserted in `tests/core/catalog-orders.test.ts`.
- **F02** — `tests/core/catalog-orders.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/catalog-orders.test.ts`.
- **F04** — /admin/payments provider status. — screen file `app/(admin)/admin/payments/page.tsx`.
- **F05** — `catalog.checkoutCart`/`payOrder`/`cancelOrder`/`getOrder`/`listOrders` at /api/v1/catalog.*, MCP `catalog_*`; `order.placed`/`paid`/`cancelled` fan out on the webhook bus. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/catalog-orders.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/catalog-orders.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/catalog-orders.test.ts` is the composition proof.

## C5.23 — Build coupons, gift cards/credit ledger, bundles, order bumps

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0058_silly_phalanx.sql`; table invariants asserted in `tests/core/promo-quote.test.ts`, `tests/core/catalog-promotions.test.ts`.
- **F02** — `tests/core/promo-quote.test.ts` — coupon/gift-card/offer rules on the typed quote boundary without parallel money paths.
- **F03** — `tests/core/promo-quote.test.ts` — gift-card credit converges through `applyCustomerBalance` on the spine.
- **F04** — customer gift-card/balance portal, not a new admin screen. — `tests/core/promo-quote.test.ts`.
- **F05** — `catalog.applyCouponToCart`/`applyGiftCardToInvoice` plus promotion services at /api/v1/catalog.*, MCP `catalog_*`; customer gift-card portal is HTTP, not a new MCP family. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/promo-quote.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/promo-quote.test.ts` — the promo/quote coverage the annotation names.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/promo-quote.test.ts` is the composition proof.

## C5.24 — Add in-person payment through capable adapters, including

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/pos-adapters.test.ts`.
- **F02** — `tests/core/pos-adapters.test.ts` — `invoicing.beginInPersonPayment`/`reconcileInPersonPayments` typed boundary for cash and Terminal.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/pos-adapters.test.ts`.
- **F04** — N/A — money convergence tests, not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `tests/core/pos-adapters.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/pos-adapters.test.ts`, `tests/core/invoicing-pos.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `commerce-pos.md` named in §43.
- **F12** — `tests/core/pos-adapters.test.ts` is the composition proof.

## C5.25 — Let a customer pay an issued invoice: a `/portal/invoices/[id]`

- **F01** — existing invoice, payment and encrypted mail-outbox tables; no schema migration. — `tests/browser/journeys.spec.ts`.
- **F02** — `customer-service.ts` provides typed customer-authorized reads and claim/provider/apply orchestration with short transactions. — `tests/browser/journeys.spec.ts`.
- **F03** — the linked contact, shared payment ledger, invoice view/email timeline, audit and mail outbox remain the single business record. — `tests/browser/journeys.spec.ts`.
- **F04** — owner email action, common customer invoice view, loading/error/ cancelled/closed states, offline instructions and explicit confirmation. — `tests/browser/journeys.spec.ts`.
- **F05** — six registered public/scoped services appear in HTTP, OpenAPI, MCP and the regenerated SDK; four internal phases remain inaccessible externally. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — en/es/fr, localized titles/returns/currency, keyboard skip links and WCAG AA checks at 390px in actual light/dark themes in `tests/browser/journeys.spec.ts`.
- **F07** — purpose-separated HMAC capabilities, retired paid/void links, seven-day minimal receipts, rate limits, stable checkout identities/URLs, and reconciliation before retrying old or changed-balance/provider attempts. — `tests/browser/journeys.spec.ts`.
- **F08** — 65 passing invoice/customer/ portal/mobile-link regressions plus 147 contract tests; browser evidence exercises issued email, session entry, offline receipt and token retirement. — `tests/browser/journeys.spec.ts`.
- **F09** — existing mail retry/observability and shared-table backup/export/ retention paths; no separate jobs or storage. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — existing adapter setup and manual default; unavailable-provider and unverified-money guidance. — `tests/browser/journeys.spec.ts`.
- **F11** — §4.3, generated SDK and `customer-invoice-payments.md` changeset. — `tests/browser/journeys.spec.ts`.
- **F12** — owner issue → encrypted invoice email → customer page → verified offline payment → paid history/confirmation; `mobile-screens.test.ts` covers the same localized invoice URL contract. Hosted-provider timeout, replay and settlement tests use adapter doubles; this evidence does not claim a live provider charge or completion of C10.26. — `tests/browser/journeys.spec.ts`.

## C5.26 — Build owner-configured calculators that compute only from inputs

- **F01** — `db/migrations/0016_calculators.sql` — `assumptions` is NOT NULL with a non-empty check, so a figure cannot be published without the caveats that produced it.
- **F02** — `tests/modules/calculators.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — No contact reference: a calculation stores nothing about who asked. `tests/core/merge-completeness.test.ts` enforces that by reflection.
- **F04** — /admin/calculators list and step builder — screen files `app/(admin)/admin/calculators/page.tsx` and `CalculatorBuilder.tsx`; public `calculator` block.
- **F05** — `calculators.create`/`update`/`publish`/`close`/`compute`/`getPublic` at /api/v1/calculators.*, MCP `calculators_*` — surface equivalence: `tests/core/api.test.ts`, `tests/core/sdk-schema.test.ts` and `tests/core/mcp.test.ts` (registry-derived).
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG A/AA over this item's surfaces in both themes in `tests/browser/calculators.spec.ts`.
- **F07** — `tests/modules/calculators.test.ts` covers a missing constant, a stale constant, out-of-bounds answers, division by zero and a closed calculator.
- **F08** — `tests/modules/calculators.test.ts` plus `tests/browser/calculators.spec.ts` — unit, service, database, permission, browser and accessibility coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared participation: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo and defaults ride `tests/core/seed-demo.test.ts`; this item ships no demo fixture of its own.
- **F11** — `deploy/spec-reconciliation.md` — the §-mapping for MASTER.md §4.18 and this item's §43 annotation; release note in `.changeset/calculators-and-coverage.md`.
- **F12** — `tests/browser/calculators.spec.ts` — a published rate, a figure, and the page falling silent when the rate is withdrawn.

## C6.01 — Build calendars for business, users and resources with timezone

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0085_calendars.sql`; table invariants asserted in `tests/core/calendars.test.ts`.
- **F02** — `tests/core/calendars.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/calendars per-service calendars. — screen file `app/(admin)/admin/calendars/page.tsx`.
- **F05** — `calendars.list`/`create`/`update`/`archive`/`setForService`/`forService` at /api/v1/calendars.*, MCP `calendars_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/calendars.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/calendars.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/calendars.test.ts` is the composition proof.

## C6.02 — Build normalized availability rules, opening hours, exceptions

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0086_availability.sql`; table invariants asserted in `tests/core/availability.test.ts`.
- **F02** — `tests/core/availability.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/availability.test.ts`.
- **F04** — /admin/calendars availability. — screen file `app/(admin)/admin/calendars/page.tsx`.
- **F05** — `availability.rules`/`setRules`/`addException`/`windows`/`copyDay` at /api/v1/availability.*, MCP `availability_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/availability.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/availability.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/availability.test.ts` is the composition proof.

## C6.03 — Implement the availability resolver for compound resources

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/resolver.test.ts`.
- **F02** — `tests/core/resolver.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/resolver.test.ts`.
- **F04** — /admin/appointments bookings. — screen file `app/(admin)/admin/appointments/page.tsx`.
- **F05** — `scheduling.slots` at /api/v1/scheduling.slots, MCP `scheduling_slots`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/resolver.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/resolver.test.ts`, `tests/core/service-composition.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/resolver.test.ts` is the composition proof.

## C6.04 — Enforce no-overlap/exclusion constraints in Postgres and prove

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/booking-concurrency.test.ts`.
- **F02** — `tests/core/booking-concurrency.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/booking-concurrency.test.ts`.
- **F04** — /admin/calendars/audiences audience links. — screen file `app/(admin)/admin/calendars/audiences/page.tsx`.
- **F05** — N/A as a new tool — overlap/exclusion is a Postgres constraint behind `bookings.create`.
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/booking-concurrency.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/booking-concurrency.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/booking-concurrency.test.ts` is the composition proof.

## C6.05 — Add booking audiences—public, token, tags and sign-in—with

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0090_booking_audiences.sql`; table invariants asserted in `tests/core/booking-audiences.test.ts`.
- **F02** — `tests/core/booking-audiences.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/booking-audiences.test.ts`.
- **F04** — public ICS `/ics/calendars/[token]`, not a new admin screen. — `tests/core/booking-audiences.test.ts`.
- **F05** — `audiences.create`/`link`/`rotateLink`/`setCalendars`/`setHours`/`setServices` at /api/v1/audiences.*, MCP `audiences_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/booking-audiences.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/booking-audiences.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/booking-audiences.test.ts` is the composition proof.

## C6.06 — Publish/import ICS and implement Google/Microsoft booking write

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/ics-and-writeback.test.ts`.
- **F02** — `tests/core/ics-and-writeback.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/ics-and-writeback.test.ts`.
- **F04** — /admin/calendars/waitlist. — screen file `app/(admin)/admin/calendars/waitlist/page.tsx`.
- **F05** — `calendars.issueFeed`/`feed`/`setIcsImport`/`revokeFeed` at /api/v1/calendars.*, MCP `calendars_*`; public ICS is `/ics/calendars/[token]` (not MCP). `bookings.ics` is MCP-excluded. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/ics-and-writeback.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/ics-and-writeback.test.ts`, `tests/core/migration-journal.test.ts`, `tests/core/route-boot.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/ics-and-writeback.test.ts` is the composition proof.) #### Bookings, rentals, and events

## C6.07 — Build booking create/hold/confirm/complete/cancel/no-show state

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/bookings.test.ts`.
- **F02** — `tests/core/bookings.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/bookings.test.ts`.
- **F04** — `/embed/booking` public booking. — `tests/core/bookings.test.ts`.
- **F05** — `bookings.create`/`setStatus`/`list`/`get` at /api/v1/bookings.*, MCP `bookings_*`; public widget is `/embed/booking`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/bookings.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/bookings.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/bookings.test.ts` is the composition proof.

## C6.08 — Add group bookings, waitlists/promotion, reschedule tokens

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0092_waitlists_and_policy.sql`; table invariants asserted in `tests/core/waitlists-and-policy.test.ts`.
- **F02** — `tests/core/waitlists-and-policy.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/waitlists-and-policy.test.ts`.
- **F04** — /admin/appointments/[id] reschedule/cancel. — screen file `app/(admin)/admin/appointments/[id]/page.tsx`.
- **F05** — `waitlist.join`/`offer`/`claim`/`list` plus `bookings.reschedule`/`addParticipant` at /api/v1, MCP `waitlist_*`/`bookings_*`. Token reschedule is MCP-excluded. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/waitlists-and-policy.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/waitlists-and-policy.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/waitlists-and-policy.test.ts` is the composition proof.

## C6.09 — Add intake forms, e-sign waivers/documents, reminders over

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0093_intake_waivers_reminders.sql`; table invariants asserted in `tests/core/intake-waivers-reminders.test.ts`.
- **F02** — `tests/core/intake-waivers-reminders.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/intake-waivers-reminders.test.ts`.
- **F04** — portal bookings, not a new admin screen. — `tests/core/intake-waivers-reminders.test.ts`.
- **F05** — `bookings.attachIntake`/`issueWaiver` plus `contracts.issueFromTemplate` at /api/v1; signing-link tokens are MCP-excluded. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/intake-waivers-reminders.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/intake-waivers-reminders.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/intake-waivers-reminders.test.ts` is the composition proof.

## C6.10 — Build rentals as resources plus catalog/inventory, availability

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0094_rentals.sql`; table invariants asserted in `tests/core/rentals.test.ts`.
- **F02** — `tests/core/rentals.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/rentals.test.ts`.
- **F04** — /admin/hire rentals. — screen file `app/(admin)/admin/hire/page.tsx`.
- **F05** — `rentals.quote`/`reserve`/`handOver`/`takeBack`/`setTerms`/`list` at /api/v1/rentals.*, MCP `rentals_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/rentals.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/rentals.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/rentals.test.ts` is the composition proof.

## C6.11 — Build events/classes with venue, sessions, seat inventory

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0059_concerned_sumo.sql`; table invariants asserted in `tests/core/events.test.ts`.
- **F02** — `tests/core/events.test.ts` — event scheduling mutations through the typed service boundary.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/events.test.ts`.
- **F04** — /admin/events list/create. — screen file `app/(admin)/admin/events/page.tsx`.
- **F05** — `events.create`/`update`/`addSession`/`addTicket`/`register`/`list`/`publish` at /api/v1/events.*, MCP `events_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/events.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/events.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/events.test.ts` is the composition proof.

## C6.12 — Build quote draft/send/view/negotiate/revise/expire/accept/

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0095_quotes.sql`; table invariants asserted in `tests/core/quotes.test.ts`.
- **F02** — `tests/core/quotes.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/quotes.test.ts`.
- **F04** — /admin/events/[id] tickets. — screen file `app/(admin)/admin/events/[id]/page.tsx`.
- **F05** — `quotes.create`/`setItems`/`send`/`revise`/`list`/`get` at /api/v1/quotes.*, MCP `quotes_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/quotes.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/quotes.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/quotes.test.ts` is the composition proof.

## C6.13 — Convert accepted quotes atomically into contracts, projects

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0098_quote_conversion.sql`; table invariants asserted in `tests/core/quote-conversion.test.ts`.
- **F02** — `tests/core/quote-conversion.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/quote-conversion.test.ts`.
- **F04** — /admin/quotes list/create. — screen file `app/(admin)/admin/quotes/page.tsx`.
- **F05** — `quotes.convert`/`setConversion`/`accept` at /api/v1/quotes.*, MCP `quotes_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/quote-conversion.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/quote-conversion.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/quote-conversion.test.ts` is the composition proof.

## C6.14 — Build contract/waiver templates, variables, click/e-sign

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0096_contract_templates.sql`; table invariants asserted in `tests/core/contract-templates.test.ts`.
- **F02** — `tests/core/contract-templates.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/contract-templates.test.ts`.
- **F04** — /admin/quotes/[id] convert-to-invoice (C11.09 F04). — screen file `app/(admin)/admin/quotes/[id]/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `contracts.issue`/`issueFromTemplate`/`sign`/`byToken` at /api/v1/contracts.*; token sign is MCP-excluded. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/contract-templates.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/contract-templates.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contract-templates.test.ts` is the composition proof.

## C6.15 — Build project/work records linking contacts, services, quotes

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0097_projects.sql`; table invariants asserted in `tests/core/projects.test.ts`.
- **F02** — `tests/core/projects.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/projects.test.ts`.
- **F04** — /admin/agreements contracts. — screen file `app/(admin)/admin/agreements/page.tsx`.
- **F05** — `projects.create`/`link`/`forSubject`/`list`/`get` at /api/v1/projects.*, MCP `projects_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/projects.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/projects.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/projects.test.ts` is the composition proof.

## C6.16 — Build time entries against projects/bookings, rate resolution

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0099_time_entries.sql`; table invariants asserted in `tests/core/time-entries.test.ts`.
- **F02** — `tests/core/time-entries.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/time-entries.test.ts`.
- **F04** — /admin/agreements/[id] sign. — screen file `app/(admin)/admin/agreements/[id]/page.tsx`.
- **F05** — `time.log`/`start`/`stop`/`invoice`/`list`/`setRate` at /api/v1/time.*, MCP `time_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/time-entries.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/time-entries.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/time-entries.test.ts` is the composition proof.

## C6.17 — Build manual invoicing, recurring/payment-plan schedules

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0100_recurring_invoices.sql`; table invariants asserted in `tests/core/recurring-invoices.test.ts`.
- **F02** — `tests/core/recurring-invoices.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/recurring-invoices.test.ts`.
- **F04** — /admin/invoices/[id] chase reminders. — screen file `app/(admin)/admin/invoices/[id]/page.tsx`.
- **F05** — `invoicing.createDraft`/`createPaymentPlan`/`createSchedule`/`scheduleReminders`/`markOverdueSweep` at /api/v1/invoicing.*, MCP `invoicing_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/recurring-invoices.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/recurring-invoices.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/recurring-invoices.test.ts` is the composition proof.

## C6.18 — Extend core/locations service areas into an enforced coverage check

- **F01** — `db/migrations/0017_postal_service_areas.sql` — `service_areas_shape` widened so a `postal_codes` area must carry at least one code.
- **F02** — `tests/core/coverage.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — no contact reference: coverage is a property of a location, not a person, and `tests/core/merge-completeness.test.ts` enforces that by reflection.
- **F04** — /admin/locations service-area form gains the postcode list — screen file `app/(admin)/admin/locations/ServiceAreaForm.tsx`; public `coverageCheck` block.
- **F05** — `locations.checkCoverage` at /api/v1/locations.*, MCP `locations_*` — surface equivalence: `tests/core/api.test.ts`, `tests/core/sdk-schema.test.ts` and `tests/core/mcp.test.ts` (registry-derived).
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG A/AA over this item's surfaces in both themes in `tests/browser/calculators.spec.ts`.
- **F07** — `tests/core/coverage.test.ts` asserts the third answer: a radius or a named region returns `unconfirmed`, never `covered`.
- **F08** — `tests/core/coverage.test.ts` plus `tests/browser/calculators.spec.ts` — unit, service, database, permission, browser and accessibility coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared participation: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; this item ships no demo fixture of its own.
- **F11** — `deploy/spec-reconciliation.md` — the §-mapping for MASTER.md §4.18 and this item's §43 annotation; release note in `.changeset/calculators-and-coverage.md`.
- **F12** — `tests/browser/calculators.spec.ts` — a listed postcode, one outside, on a real page.

## C7.01 — Build configurable lifecycle and deal pipelines, stages

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0101_pipelines.sql`; table invariants asserted in `tests/core/pipelines.test.ts`.
- **F02** — `tests/core/pipelines.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/pipelines.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/pipeline deals and lifecycle. — screen file `app/(admin)/admin/pipeline/page.tsx`.
- **F05** — `crm.listPipelines`/`savePipeline`/`createDeal`/`moveDeal`/`updateDeal`/`listDeals`/`lifecycleBoard` at /api/v1/crm.*, MCP `crm_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/pipelines.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/pipelines.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/pipelines.test.ts` is the composition proof.

## C7.02 — Build tasks attachable to any entity, assignment, due/reminder

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0102_tasks.sql`; table invariants asserted in `tests/core/tasks.test.ts`, `tests/core/record-trash.test.ts`.
- **F02** — `tests/core/tasks.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/tasks.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/tasks and /admin/trash?kind=tasks. — screen files `app/(admin)/admin/tasks/page.tsx`, `app/(admin)/admin/trash/page.tsx`.
- **F05** — `tasks.create`/`list`/`update`/`setStatus`/`remove`/`restore`/`purge` plus `projects.addTask` at /api/v1/tasks.* and /api/v1/projects.addTask, MCP `tasks_*`/`projects_addTask`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/tasks.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/tasks.test.ts`, `tests/core/record-trash.test.ts` — the item's unit/service/database coverage.
- **F09** — `tests/core/record-trash.test.ts` covers restore, privacy erasure, retention holds and merged ownership; `deploy/record-trash.md` covers recovery and the bounded daily purge. Other record families remain C11.14 work.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/tasks.test.ts` is the composition proof.

## C7.03 — Build notes with mentions, pinning, visibility, edit history and

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0103_notes.sql`; table invariants asserted in `tests/core/notes.test.ts`, `tests/core/record-trash.test.ts`.
- **F02** — `tests/core/notes.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/notes.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — shared `NotesPanel` on contact/entity records and /admin/trash?kind=notes. — screen file `app/(admin)/admin/trash/page.tsx`.
- **F05** — `notes.write`/`edit`/`pin`/`list`/`history`/`remove`/`restore`/`purge` at /api/v1/notes.*, MCP `notes_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/notes.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/notes.test.ts`, `tests/core/record-trash.test.ts` — the item's unit/service/database coverage.
- **F09** — `tests/core/record-trash.test.ts` covers restore, privacy erasure, retention holds and merged ownership; `deploy/record-trash.md` covers recovery and the bounded daily purge. Other record families remain C11.14 work.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/notes.test.ts` is the composition proof.

## C7.04 — Build the canonical segment query model, static/dynamic modes

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0104_segments.sql`; table invariants asserted in `tests/core/segments.test.ts`.
- **F02** — `tests/core/segments.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/segments.test.ts`.
- **F04** — /admin/segments save/preview (C11.09 F04). — screen file `app/(admin)/admin/segments/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `segments.save`/`preview`/`list`/`members`/`contains` at /api/v1/segments.*, MCP `segments_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/segments.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/segments.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/segments.test.ts` is the composition proof.

## C7.05 — Build transparent scoring rules with decay, reason display

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0105_scoring.sql`; table invariants asserted in `tests/core/scoring.test.ts`.
- **F02** — `tests/core/scoring.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/scoring.test.ts`.
- **F04** — /admin/scoring scores. — screen file `app/(admin)/admin/scoring/page.tsx`.
- **F05** — `scoring.rules`/`saveRule`/`why`/`for`/`award` at /api/v1/scoring.*, MCP `scoring_*` (`scoring.advance` is MCP-excluded). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/scoring.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/scoring.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/scoring.test.ts` is the composition proof.

## C7.06 — Build saved views with filters/columns/sort, ownership/sharing

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0106_saved_views.sql`; table invariants asserted in `tests/core/saved-views.test.ts`.
- **F02** — `tests/core/saved-views.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/saved-views.test.ts`.
- **F04** — /admin/inbox conversations. — screen file `app/(admin)/admin/inbox/page.tsx`.
- **F05** — `views.list`/`save`/`setDefault`/`remove` at /api/v1/views.*, MCP `views_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/saved-views.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/saved-views.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/saved-views.test.ts` is the composition proof.

## C7.07 — Build CSV import as map → validate → dry-run diff → commit →

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0107_contact_imports.sql`; table invariants asserted in `tests/core/contact-import.test.ts`.
- **F02** — `tests/core/contact-import.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/contact-import.test.ts`.
- **F04** — /admin/inbox assign/snooze/close. — screen file `app/(admin)/admin/inbox/page.tsx`.
- **F05** — `contactImports.begin`/`map`/`commit`/`revert`/`list`/`get` at /api/v1/contactImports.*, MCP `contactImports_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/contact-import.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/contact-import.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/contact-import.test.ts` is the composition proof.) #### Conversations and messaging

## C7.08 — Build canonical conversations/messages/deliveries threaded by

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0108_conversations.sql`; table invariants asserted in `tests/core/conversations.test.ts`.
- **F02** — `tests/core/conversations.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/conversations.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/inbox timeline. — screen file `app/(admin)/admin/inbox/page.tsx`.
- **F05** — `conversations.record`/`list`/`get`/`markRead`/`recordDelivery` at /api/v1/conversations.*, MCP `conversations_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/conversations.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/conversations.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/conversations.test.ts` is the composition proof.

## C7.09 — Build assign/snooze/close/unread/search/filter/bulk workflows

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0109_inbox_search.sql`; table invariants asserted in `tests/core/inbox.test.ts`.
- **F02** — `tests/core/inbox.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/inbox.test.ts`.
- **F04** — /admin/inbox search/bulk. — screen file `app/(admin)/admin/inbox/page.tsx`.
- **F05** — `conversations.assign`/`snooze`/`setStatus`/`reply`/`bulk`/`search`/`counts` at /api/v1/conversations.*, MCP `conversations_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/inbox.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/inbox.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/inbox.test.ts` is the composition proof.

## C7.10 — Build SMS adapter contract and at least one production adapter

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0110_messaging_numbers.sql`; table invariants asserted in `tests/core/sms.test.ts`.
- **F02** — `tests/core/sms.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/sms.test.ts`.
- **F04** — /admin/messaging numbers. — screen file `app/(admin)/admin/messaging/page.tsx`.
- **F05** — `messaging.sendSms`/`numbers`/`importNumbers` at /api/v1/messaging.*, MCP `messaging_*`; Twilio feedback is /api/sms/webhooks/twilio (not MCP). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/sms.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/sms.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/sms.test.ts` is the composition proof.

## C7.11 — Track 10DLC/toll-free/alphanumeric registration states and

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0111_number_registrations.sql`; table invariants asserted in `tests/core/sms-registration.test.ts`.
- **F02** — `tests/core/sms-registration.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/messaging registration. — screen file `app/(admin)/admin/messaging/page.tsx`.
- **F05** — `messaging.registrations`/`setRegistration`/`checkNumbers` at /api/v1/messaging.*, MCP `messaging_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/sms-registration.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/sms-registration.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/sms-registration.test.ts` is the composition proof.

## C7.12 — Enforce per-purpose/channel consent, STOP/START/HELP before all

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/sms-consent.test.ts`.
- **F02** — `tests/core/sms-consent.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/sms-consent.test.ts`.
- **F04** — /admin/messaging compliance events (C11.09 F04). — screen file `app/(admin)/admin/messaging/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `messaging.complianceEvents` plus the consent gate on `messaging.sendSms` at /api/v1/messaging.*, MCP `messaging_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/sms-consent.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/sms-consent.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/sms-consent.test.ts` is the composition proof.

## C7.13 — Enforce recipient-timezone quiet hours, frequency caps and

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/sms-policy.test.ts`.
- **F02** — `tests/core/sms-policy.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/sms-policy.test.ts`.
- **F04** — /admin/messaging quiet hours (C11.09 F04). — screen file `app/(admin)/admin/messaging/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `messaging.evaluateSmsPolicy`/`setWindow` at /api/v1/messaging.*, MCP `messaging_*` (quiet hours/caps before send). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/sms-policy.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/sms-policy.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/sms-policy.test.ts` is the composition proof.

## C7.14 — Add templates/locale variables, two-way keywords, booking

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0114_messaging_keywords_templates_mms.sql`; table invariants asserted in `tests/core/sms-templates.test.ts`.
- **F02** — `tests/core/sms-templates.test.ts` + `tests/core/sms-keywords.test.ts` — template variables, keyword actions and booking confirmation on the messaging service.
- **F03** — `tests/core/sms-templates.test.ts` — template/keyword evidence is contact-bound and idempotent.
- **F04** — /admin/messaging keyword rules (C11.09 F04). — screen file `app/(admin)/admin/messaging/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `messaging.keywordRules`/`createKeywordRule`/`updateKeywordRule`/`deleteKeywordRule`/`keywordEvents` at /api/v1/messaging.*, MCP `messaging_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/sms-templates.test.ts`.
- **F08** — `tests/core/sms-templates.test.ts`, `tests/core/sms-keywords.test.ts`, `tests/core/sms-consent.test.ts` — the messaging template/keyword/MMS coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `sms-templates-keywords-mms.md` named in §43.
- **F12** — changeset `sms-templates-keywords-mms.md` landed with the rest of the spine. — `tests/core/sms-templates.test.ts`.

## C7.15 — Add site live chat, assistant escalation and WhatsApp/Messenger

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0115_site_live_chat.sql`; table invariants asserted in `tests/core/site-chat.test.ts`.
- **F02** — `tests/core/site-chat.test.ts` — the cookie-bound chat transport and owner-reply refusal when no active browser exists.
- **F03** — `tests/core/site-chat.test.ts` — chat messages bind to the canonical contact conversation.
- **F04** — /admin/contacts/[id] notes. — screen file `app/(admin)/admin/contacts/[id]/page.tsx`.
- **F05** — `messaging.postSiteChat`/`getSiteChat`/`endSiteChat`/`escalateAssistantChat` at /api/v1/messaging.* plus /api/chat; MCP `messaging_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/site-chat.test.ts`.
- **F08** — `tests/core/site-chat.test.ts` + `tests/modules/assistant.test.ts` — live chat, escalation and assistant-channel coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `site-live-chat.md` named in §43.
- **F12** — changeset `site-live-chat.md` landed with the rest of the spine. — `tests/core/site-chat.test.ts`.

## C7.16 — Let owners opt selected signup flows into a skippable post-

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — the reviewed baseline folding the item's `0116_signup_contact_import` tag; policy tables asserted in `tests/core/signup-contact-import.test.ts`.
- **F02** — `tests/core/signup-contact-import.test.ts` — off-by-default owner-only policy, source/field/count snapshots and refusal.
- **F03** — `tests/core/signup-contact-import.test.ts` — per-row relationship undo and no-implied-consent on the contact spine.
- **F04** — contact timeline on /admin/contacts/[id]. — screen file `app/(admin)/admin/contacts/[id]/page.tsx`.
- **F05** — signup-contact OAuth callbacks at /api/connections/signup-contacts/[provider]/callback; claim/apply services are MCP-excluded (credential exchange). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/signup-contact-import.test.ts`.
- **F08** — `tests/core/signup-contact-import.test.ts` + `tests/core/contact-import.test.ts` — the import batches and consent proof.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `signup-contact-import.md` named in §43.
- **F12** — changeset `signup-contact-import.md` landed with the rest of the spine. — `tests/core/signup-contact-import.test.ts`.

## C7.17 — Adopt the C7.04 segment model as the audience for campaign

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0139_automation_entry_segment.sql`; table invariants asserted in `tests/modules/one-audience.test.ts`.
- **F02** — `tests/modules/one-audience.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/one-audience.test.ts`.
- **F04** — /admin/segments as the one 'who'. — screen file `app/(admin)/admin/segments/page.tsx`.
- **F05** — `segments.contains`/`members` at /api/v1/segments.contains and /api/v1/segments.members as the campaign audience (same C7.04 family). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/one-audience.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/one-audience.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/one-audience.test.ts` is the composition proof.

## C8.01 — Build projects/case studies with services, outcomes, metrics

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0117_project_case_studies.sql`; table invariants asserted in `tests/core/project-case-studies.test.ts`.
- **F02** — `tests/core/project-case-studies.test.ts` — publish/republish snapshot boundary with explicit reviewed state.
- **F03** — `tests/core/project-case-studies.test.ts` — client-publication permission evidence is contact-bound.
- **F04** — /admin/projects collections. — screen file `app/(admin)/admin/projects/page.tsx`.
- **F05** — `projects.create`/`publish`/`publicForService`/`list`/`get` at /api/v1/projects.*, MCP `projects_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/project-case-studies.test.ts`.
- **F08** — `tests/core/project-case-studies.test.ts` + `tests/core/projects.test.ts` — case-study blocks and the single Project record.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `project-case-studies.md` named in §43.
- **F12** — changeset `project-case-studies.md` landed with the rest of the spine. — `tests/core/project-case-studies.test.ts`.

## C8.02 — Build public portfolios and collections using CMS templates

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — the reviewed baseline folding the item's `0118_project_portfolios.sql` tag; collection tables asserted in `tests/core/project-portfolios.test.ts`.
- **F02** — `tests/core/project-portfolios.test.ts` — collection membership, ordering and publication boundary.
- **F03** — N/A — collections are CMS content; contact attribution lives on the Project record (C8.01).
- **F04** — /admin/projects/[id] tasks. — screen file `app/(admin)/admin/projects/[id]/page.tsx`.
- **F05** — `projects.createCollection`/`publishCollection`/`portfolioBrowse`/`listCollections` at /api/v1/projects.*, MCP `projects_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — service permission checks and destructive confirmation on the caller. — `tests/core/project-portfolios.test.ts`.
- **F08** — `tests/core/project-portfolios.test.ts` — portfolio/collection surface coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `public-project-portfolios.md` named in §43.
- **F12** — changeset `public-project-portfolios.md` landed with the rest of the spine. — `tests/core/project-portfolios.test.ts`.

## C8.03 — Build private client galleries with PIN/magic-link/login access

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0119_client_galleries.sql`; table invariants asserted in `tests/core/client-galleries.test.ts`.
- **F02** — `tests/core/client-galleries.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/client-galleries.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/time time entries. — screen file `app/(admin)/admin/time/page.tsx`.
- **F05** — `galleries.create`/`inviteGuest`/`unlock`/`myGalleries`/`list` at /api/v1/galleries.*, MCP `galleries_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/client-galleries.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/client-galleries.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/client-galleries.test.ts` is the composition proof.

## C8.04 — Render watermarked variants, and make `download_policy` decide

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/media-watermark.test.ts`.
- **F02** — `tests/core/media-watermark.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/client-galleries.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/galleries list/create. — screen file `app/(admin)/admin/galleries/page.tsx`.
- **F05** — `media.backfillWatermarks` plus `galleries.downloadItem`/`viewItem` at /api/v1/media.backfillWatermarks and /api/v1/galleries.*, MCP `media_*`/`galleries_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/media-watermark.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/media-watermark.test.ts`, `tests/core/client-galleries.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/media-watermark.test.ts` is the composition proof.

## C8.05 — Add gallery proofing: `GallerySelection` favorites, selects and

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0121_gallery_selections.sql`; table invariants asserted in `tests/core/gallery-proofing.test.ts`.
- **F02** — `tests/core/gallery-proofing.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/gallery-proofing.test.ts`.
- **F04** — /admin/galleries/[id] proofing. — screen file `app/(admin)/admin/galleries/[id]/page.tsx`.
- **F05** — `galleries.setSelection`/`listSelections`/`clearSelection` at /api/v1/galleries.*, MCP `galleries_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/gallery-proofing.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/gallery-proofing.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/gallery-proofing.test.ts` is the composition proof.

## C8.06 — Add approval rounds over a selection set — the owner finalizes

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0122_gallery_rounds.sql`; table invariants asserted in `tests/core/gallery-rounds.test.ts`.
- **F02** — `tests/core/gallery-rounds.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/gallery-rounds.test.ts`.
- **F04** — `/embed/gallery/[slug]` public gallery. — `tests/core/gallery-rounds.test.ts`.
- **F05** — `galleries.submitRound`/`approveRound`/`reopenRound`/`listRounds` at /api/v1/galleries.*, MCP `galleries_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/gallery-rounds.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/gallery-rounds.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/gallery-rounds.test.ts` is the composition proof.

## C8.07 — Add archive/package delivery of a finished gallery and the

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0123_gallery_archives.sql`; table invariants asserted in `tests/core/gallery-archive.test.ts`.
- **F02** — `tests/core/gallery-archive.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — portal galleries, not a new admin screen. — `tests/core/gallery-archive.test.ts`.
- **F05** — `galleries.requestArchive` at /api/v1/galleries.requestArchive, MCP `galleries_requestArchive`; build is the `galleries.buildArchives` job. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/gallery-archive.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/gallery-archive.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/gallery-archive.test.ts` is the composition proof.

## C8.08 — Add print/digital gallery sales through catalog/cart/orders and

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0124_gallery_sales.sql`; table invariants asserted in `tests/core/gallery-sales.test.ts`.
- **F02** — `tests/core/gallery-sales.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/gallery-sales.test.ts`.
- **F04** — /admin/galleries/[id] price sheet through catalog. — screen file `app/(admin)/admin/galleries/[id]/page.tsx`.
- **F05** — `catalog.addCartItem` through the gallery price sheet at /api/v1/catalog.addCartItem, MCP `catalog_addCartItem`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/gallery-sales.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/gallery-sales.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/gallery-sales.test.ts` is the composition proof.

## C8.09 — Build review requests after purchases/bookings, moderation

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0125_reviews.sql`; table invariants asserted in `tests/core/reviews.test.ts`.
- **F02** — `tests/core/reviews.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/reviews.test.ts`.
- **F04** — /admin/reviews moderate/reply/request (C11.09 F04 sibling). — screen file `app/(admin)/admin/reviews/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `reviews.list`/`moderate`/`reply`/`request`/`submit`/`published` at /api/v1/reviews.*, MCP `reviews_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/reviews.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/reviews.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/reviews.test.ts` is the composition proof.

## C8.10 — Build the customer portal shell with magic-link/password auth

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/portal-shell.test.ts`.
- **F02** — `tests/core/portal-shell.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/portal-shell.test.ts`.
- **F04** — customer portal shell `/portal`. — `tests/core/portal-shell.test.ts`.
- **F05** — `portal.myProfile`/`updateMyProfile`/`myRecords` at /api/v1/portal.*, MCP `portal_*`; magic-link/password stay `auth.*` (MCP-excluded). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/portal-shell.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/portal-shell.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/portal-shell.test.ts` is the composition proof.

## C8.11 — Add portal quotes/contracts/invoices/payments, bookings/events/

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/portal-rooms.test.ts`.
- **F02** — `tests/core/portal-rooms.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/portal-rooms.test.ts`.
- **F04** — portal rooms for quotes/invoices/bookings. — `tests/core/portal-rooms.test.ts`.
- **F05** — portal rooms reuse `quotes.list`/`invoicing.*`/`bookings.myLinks` under the signed-in actor at /api/v1; no extra MCP family. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/portal-rooms.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/portal-rooms.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/portal-rooms.test.ts` is the composition proof.

## C8.12 — Build a CMS-backed help centre/knowledge base with categories

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0126_help_centre.sql`; table invariants asserted in `tests/modules/help-centre.test.ts`.
- **F02** — `tests/modules/help-centre.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/pages help categories and /admin/pages/[id] file-in-help-centre (C11.09 F04) — not a second CMS. — screen files `app/(admin)/admin/pages/page.tsx`, `app/(admin)/admin/pages/[id]/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `cms.helpCategories`/`helpArticles`/`searchHelp`/`fileHelpArticle`/`saveHelpCategory` at /api/v1/cms.*, MCP `cms_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/help-centre.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/help-centre.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/help-centre.test.ts` is the composition proof.

## C8.13 — Build documents/files shared to contacts/projects/portal with

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0132_documents.sql`; table invariants asserted in `tests/modules/documents.test.ts`.
- **F02** — `tests/modules/documents.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/modules/documents.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/documents share with contacts. — screen file `app/(admin)/admin/documents/page.tsx`.
- **F05** — `documents.save`/`share`/`open`/`list`/`export`/`revokeShare` at /api/v1/documents.*, MCP `documents_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/documents.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/documents.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/documents.test.ts` is the composition proof.

## C8.14 — Build owner-authored guided assessments

- **F01** — `db/migrations/0013_assessments.sql` — `assessment_responses.band_id` NOT NULL + RESTRICT makes an unauthored outcome unrepresentable; `assessment_bands_no_overlap` (EXCLUDE USING gist) makes two bands over one score impossible.
- **F02** — `tests/modules/assessments.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `registerContactReference` + `registerContactPrivacySource` for `assessment_responses`; asserted by `tests/core/merge-completeness.test.ts` and `tests/core/c11-14-retention.test.ts`.
- **F04** — /admin/assessments list, question builder, band and escalation editors — screen file `app/(admin)/admin/assessments/page.tsx`; public `assessment` block in `src/modules/assessments/block.tsx`.
- **F05** — `assessments.create`/`update`/`publish`/`close`/`respond`/`saveBand`/`saveEscalation` at /api/v1/assessments.*, MCP `assessments_*` — surface equivalence: `tests/core/api.test.ts`, `tests/core/sdk-schema.test.ts` and `tests/core/mcp.test.ts` (registry-derived).
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG A/AA over this item's surfaces in both themes in `tests/browser/assessments.spec.ts`.
- **F07** — `tests/modules/assessments.test.ts` covers permission, refusal, escalation override, idempotency and the concurrent double-post.
- **F08** — `tests/modules/assessments.test.ts` plus `tests/browser/assessments.spec.ts` — unit, service, database, permission, browser and accessibility coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared participation: `tests/core/record-participation.test.ts`.
- **F10** — `src/modules/assessments/onboarding.ts` ships a demo heating check in en/fr/es, loaded, verified and purged by the tracked demo run.
- **F11** — `deploy/spec-reconciliation.md` — the §-mapping for MASTER.md §4.18 and this item's §43 annotation; release note in `.changeset/owner-authored-assessments.md`.
- **F12** — `tests/browser/assessments.spec.ts` — refused for a gap, fixed, published, answered, escalated.

## C8.15 — Build as-of dated published facts with a correction ledger

- **F01** — `db/migrations/0014_attestations.sql` — `attestations_current_idx` allows one current fact per key and subject (COALESCE-based, so a business-wide figure is not exempt); `attestations_one_correction_idx` stops the ledger forking.
- **F02** — `tests/core/attestations.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — no contact reference: a published figure is about the business, not a person, and `tests/core/merge-completeness.test.ts` enforces that by reflection.
- **F04** — /admin/facts list and ledger — screen files `app/(admin)/admin/facts/page.tsx` and `[key]/page.tsx`; public `fact` block.
- **F05** — `attestations.record`/`correct`/`withdraw`/`current`/`history`/`list` at /api/v1/attestations.*, MCP `attestations_*` — surface equivalence: `tests/core/api.test.ts`, `tests/core/sdk-schema.test.ts` and `tests/core/mcp.test.ts` (registry-derived).
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG A/AA over this item's surfaces in both themes in `tests/browser/facts.spec.ts`.
- **F07** — `tests/core/attestations.test.ts` covers a backwards-dated correction, a lapsed fact, withdrawal and the grant boundary.
- **F08** — `tests/core/attestations.test.ts` plus `tests/browser/facts.spec.ts` — unit, service, database, permission, browser and accessibility coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared participation: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; this item ships no demo fixture of its own.
- **F11** — `deploy/spec-reconciliation.md` — the §-mapping for MASTER.md §4.18 and this item's §43 annotation; release note in `.changeset/attested-facts-and-corrections.md`.
- **F12** — `tests/browser/facts.spec.ts` — published, corrected, withdrawn, with the page falling silent.

## C8.16 — Build consent-gated progress and comparison media

- **F01** — `db/migrations/0015_media_consents.sql` — `media_consents` is append-only by construction; `project_files_series` ties a progress step to its series key. The old consent columns are kept, not dropped, per `tests/core/schema-compat-gate.test.ts`.
- **F02** — `tests/core/media-consent.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` and `tests/core/c11-14-retention.test.ts` — `media_consents` repoints on merge and registers export/erasure; erasure keeps the decisions and clears the free-text note.
- **F04** — /admin/projects/[id] records, withdraws and lists consent decisions, and authors a progress series — screen file `app/(admin)/admin/projects/[id]/page.tsx`.
- **F05** — `privacy.grantMediaConsent`/`withdrawMediaConsent`/`mediaConsent`/`mediaConsentHistory` at /api/v1/privacy.*, MCP `privacy_*` — surface equivalence: `tests/core/api.test.ts`, `tests/core/sdk-schema.test.ts` and `tests/core/mcp.test.ts` (registry-derived).
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG A/AA over this item's surfaces in both themes in `tests/browser/media-consent.spec.ts`.
- **F07** — `tests/core/media-consent.test.ts` asserts the grant survives withdrawal, lapsed consent reads as lapsed, and effect-time ordering cannot reinstate a withdrawal.
- **F08** — `tests/core/media-consent.test.ts` plus `tests/browser/media-consent.spec.ts` — unit, service, database, permission, browser and accessibility coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared participation: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; this item ships no demo fixture of its own.
- **F11** — `deploy/spec-reconciliation.md` — the §-mapping for MASTER.md §4.18 and this item's §43 annotation; release note in `.changeset/consent-is-evidence.md`.
- **F12** — `tests/core/media-consent.test.ts` — the hourly sweep takes published work offline when its permission stops standing.

## C9.01 — Build visual trigger → condition → action automations over the

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0133_automations.sql`; table invariants asserted in `tests/modules/automations.test.ts`.
- **F02** — `tests/modules/automations.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/automations.test.ts`.
- **F04** — /admin/automations list/create. — screen file `app/(admin)/admin/automations/page.tsx`.
- **F05** — `automations.save`/`list`/`get`/`publish`/`triggers`/`verbs` at /api/v1/automations.*, MCP `automations_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/automations.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/automations.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/automations.test.ts` is the composition proof.

## C9.02 — Add delays, schedules, branches, loops with hard bounds

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0134_core_runs.sql`, `0135_automation_runtime.sql`; table invariants asserted in `tests/modules/automations-runtime.test.ts`.
- **F02** — `tests/modules/automations-runtime.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/automations-runtime.test.ts`.
- **F04** — /admin/automations/[id] graph editor. — screen file `app/(admin)/admin/automations/[id]/page.tsx`.
- **F05** — `automations.validate`/`versions`/`versionGraph`/`restoreVersion` at /api/v1/automations.*, MCP `automations_*` (graph persists through `automations.save`). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/automations-runtime.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/automations-runtime.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/automations-runtime.test.ts` is the composition proof.

## C9.03 — Enforce consent, quiet hours, budgets, approval requirements and

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/modules/automations-guardrails.test.ts`.
- **F02** — `tests/modules/automations-guardrails.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/automations-guardrails.test.ts`.
- **F04** — /admin/automations/[id] run list/kill (C11.09 F04). — screen file `app/(admin)/admin/automations/[id]/page.tsx`; caller greps in `tests/core/f04-remaining-screens.test.ts`.
- **F05** — `automations.checkGuardrails`/`runs`/`inspectRun`/`killRun` at /api/v1/automations.*, MCP `automations_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/automations-guardrails.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/automations-guardrails.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/automations-guardrails.test.ts` is the composition proof.

## C9.04 — Build newsletters, double-opt-in subscriptions, RFC 8058 one-

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0059_concerned_sumo.sql`; table invariants asserted in `tests/core/newsletters.test.ts`.
- **F02** — `tests/core/newsletters.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/newsletters.test.ts`.
- **F04** — /admin/newsletters subscriptions. — screen file `app/(admin)/admin/newsletters/page.tsx`.
- **F05** — `newsletters.create`/`subscribe`/`confirm`/`unsubscribe`/`list` at /api/v1/newsletters.*, MCP `newsletters_*`; public `/newsletters/confirm` and `/unsubscribe`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/newsletters.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/newsletters.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/newsletters.test.ts` is the composition proof.

## C9.05 — Build shared block-based templates for transactional, campaign

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0136_message_templates.sql`; table invariants asserted in `tests/modules/templates.test.ts`.
- **F02** — `tests/modules/templates.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/templates.test.ts`.
- **F04** — /admin/newsletters/templates. — screen file `app/(admin)/admin/newsletters/templates/page.tsx`.
- **F05** — `templates.list`/`save`/`render`/`slots` plus `cms.ensureTemplates` at /api/v1/templates.* and /api/v1/cms.ensureTemplates, MCP `templates_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/templates.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/templates.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/templates.test.ts` is the composition proof.

## C9.06 — Build broadcasts/segments, test sends, scheduling, provider

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0137_broadcasts.sql`; table invariants asserted in `tests/modules/broadcasts.test.ts`.
- **F02** — `tests/modules/broadcasts.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/broadcasts.test.ts`.
- **F04** — /admin/newsletters/broadcasts. — screen file `app/(admin)/admin/newsletters/broadcasts/page.tsx`.
- **F05** — `broadcasts.save`/`testSend`/`start`/`pause`/`resume`/`list`/`stats` at /api/v1/broadcasts.*, MCP `broadcasts_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/broadcasts.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/broadcasts.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/broadcasts.test.ts` is the composition proof.

## C9.07 — Complete the funnel from visit → lead → quote/booking/cart →

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/modules/funnel.test.ts`.
- **F02** — `tests/modules/funnel.test.ts` — funnel banding computed through the typed analytics service.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/funnel.test.ts`.
- **F04** — /admin/traffic/funnel. — screen file `app/(admin)/admin/traffic/funnel/page.tsx`.
- **F05** — `analytics.funnel`/`funnelDefinitions`/`identify` at /api/v1/analytics.*, MCP `analytics_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/funnel.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/modules/funnel.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/funnel.test.ts` is the composition proof.

## C9.08 — Build reporting saved views and the revenue/service/product/

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0138_report_views.sql`; table invariants asserted in `tests/modules/reporting.test.ts`.
- **F02** — `tests/modules/reporting.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/reporting.test.ts`.
- **F04** — /admin/reports. — screen file `app/(admin)/admin/reports/page.tsx`.
- **F05** — `reports.revenue`/`revenueBy`/`funnel`/`cohort`/`saveView`/`listViews` at /api/v1/reports.*, MCP `reports_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/reporting.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/reporting.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/reporting.test.ts` is the composition proof.) #### Referral, loyalty, subscriptions, and paywalls

## C9.09 — Build first-party attribution touches, codes, invitations

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0129_referrals_attribution.sql`; table invariants asserted in `tests/modules/referrals.test.ts`.
- **F02** — `tests/modules/referrals.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/referrals.test.ts`.
- **F04** — /admin/referrals attribution. — screen file `app/(admin)/admin/referrals/page.tsx`.
- **F05** — `referrals.recordTouch`/`issueCode`/`invite`/`codes`/`programs`/`saveProgram` at /api/v1/referrals.*, MCP `referrals_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/referrals.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/referrals.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/referrals.test.ts` is the composition proof.

## C9.10 — Build commission events, holdbacks, refund reversal, payout

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0131_commissions_payouts.sql`; table invariants asserted in `tests/modules/referrals-commission.test.ts`.
- **F02** — `tests/modules/referrals-commission.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/modules/referrals-commission.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/referrals/payouts. — `tests/modules/referrals-commission.test.ts`.
- **F05** — `referrals.buildPayoutBatch`/`approvePayoutBatch`/`markPayoutBatchPaid`/`payoutBatches`/`payoutBatchCsv` at /api/v1/referrals.*, MCP `referrals_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/referrals-commission.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/referrals-commission.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/referrals-commission.test.ts` is the composition proof.

## C9.11 — Build loyalty programs, accounts and append-only points ledger

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0127_loyalty.sql`; table invariants asserted in `tests/modules/loyalty.test.ts`.
- **F02** — `tests/modules/loyalty.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/modules/loyalty.test.ts` — spine wiring asserted (merge repoint + audit/timeline) for this item's records.
- **F04** — /admin/loyalty ledger. — screen file `app/(admin)/admin/loyalty/page.tsx`.
- **F05** — `loyalty.saveProgram`/`enrol`/`adjustPoints`/`statement`/`myStatement` at /api/v1/loyalty.*, MCP `loyalty_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/loyalty.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/loyalty.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/loyalty.test.ts` is the composition proof.

## C9.12 — Build tiers/evaluation, rewards/redemption through normal money

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0128_loyalty_tiers_rewards.sql`; table invariants asserted in `tests/modules/loyalty-rewards.test.ts`.
- **F02** — `tests/modules/loyalty-rewards.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/loyalty-rewards.test.ts`.
- **F04** — /admin/loyalty tiers/rewards. — screen file `app/(admin)/admin/loyalty/page.tsx`.
- **F05** — `loyalty.saveTier`/`saveReward`/`redeem`/`reevaluateTier`/`tiers`/`rewards` at /api/v1/loyalty.*, MCP `loyalty_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/loyalty-rewards.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/loyalty-rewards.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/loyalty-rewards.test.ts` is the composition proof.

## C9.13 — Build plans, the subscription lifecycle and its events, trials

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0140_subscriptions.sql`; table invariants asserted in `tests/modules/subscriptions.test.ts`.
- **F02** — `tests/modules/subscriptions.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/subscriptions.test.ts`.
- **F04** — /admin/subscriptions plans. — screen file `app/(admin)/admin/subscriptions/page.tsx`.
- **F05** — `subscriptions.enroll`/`list`/`get`/`cancel`/`changePlan` at /api/v1/subscriptions.*, MCP `subscriptions_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/subscriptions.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/subscriptions.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/subscriptions.test.ts` is the composition proof.

## C9.14 — Build entitlements/grants for subscriptions, passes, retainers

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0142_entitlements.sql`; table invariants asserted in `tests/core/entitlements.test.ts`.
- **F02** — `tests/core/entitlements.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/entitlements.test.ts`.
- **F04** — /admin/access entitlements. — screen file `app/(admin)/admin/access/page.tsx`.
- **F05** — `entitlements.save`/`grant`/`revoke`/`hasAccess`/`issuePass`/`issueUnlock` plus `subscriptions.grants` at /api/v1/entitlements.*, MCP `entitlements_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/entitlements.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/entitlements.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/entitlements.test.ts` is the composition proof.

## C9.15 — Build hard/soft/metered/registration paywalls, server-side

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0143_paywalls.sql`; table invariants asserted in `tests/core/paywalls.test.ts`.
- **F02** — `tests/core/paywalls.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/paywalls.test.ts`.
- **F04** — /admin/paywalls. — screen file `app/(admin)/admin/paywalls/page.tsx`.
- **F05** — `paywalls.evaluate`/`list`/`save` at /api/v1/paywalls.*, MCP `paywalls_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/paywalls.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/paywalls.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/paywalls.test.ts` is the composition proof.

## C9.16 — Build dunning retries, grace periods, consented notices, final

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0144_dunning.sql`; table invariants asserted in `tests/modules/subscriptions.test.ts`.
- **F02** — `tests/modules/subscriptions.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/subscriptions.test.ts`.
- **F04** — /admin/subscriptions dunning. — screen file `app/(admin)/admin/subscriptions/page.tsx`.
- **F05** — `subscriptions.advanceDunning`/`recoverDunning` at /api/v1/subscriptions.*, MCP `subscriptions_*`; notices ride `notifications.create`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/subscriptions.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/subscriptions.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/subscriptions.test.ts` is the composition proof.) #### Advertising, assistant, social, and sharing

## C9.17 — Build ad sizes/slots, breakpoint reservations, advertisers

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0130_ad_inventory.sql`; table invariants asserted in `tests/modules/ads.test.ts`.
- **F02** — `tests/modules/ads.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/ads.test.ts`.
- **F04** — /admin/ads inventory. — screen file `app/(admin)/admin/ads/page.tsx`.
- **F05** — `ads.saveAdvertiser`/`saveCampaign`/`saveLineItem`/`ensureSizes`/`adsTxt` at /api/v1/ads.*, MCP `ads_*`; public `/ads.txt`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/ads.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/ads.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/ads.test.ts` is the composition proof.

## C9.18 — Build house/sold creatives, money-path invoices, labelled

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/modules/ads-serving.test.ts`.
- **F02** — `tests/modules/ads-serving.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/ads-serving.test.ts`.
- **F04** — /admin/ads creatives. — screen file `app/(admin)/admin/ads/page.tsx`.
- **F05** — `ads.saveCreative`/`reviewCreative`/`invoiceCampaign`/`serve` at /api/v1/ads.*, MCP `ads_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/ads-serving.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/ads-serving.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/ads-serving.test.ts` is the composition proof.

## C9.19 — Build first-party impression/viewability/unique/click events

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0145_ad_stats.sql`; table invariants asserted in `tests/modules/ads-measurement.test.ts`.
- **F02** — `tests/modules/ads-measurement.test.ts` — ad measurement attribution through the typed service boundary.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/ads-measurement.test.ts`.
- **F04** — /admin/ads measurement. — screen file `app/(admin)/admin/ads/page.tsx`.
- **F05** — `ads.recordBeacon`/`recordClick`/`rollUpStats`/`campaignReport` at /api/v1/ads.*, MCP `ads_*`; public /api/ads/view. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/ads-measurement.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/modules/ads-measurement.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/ads-measurement.test.ts` is the composition proof.

## C9.20 — Support consent-gated third-party tags off by default and

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0146_ad_third_party.sql`; table invariants asserted in `tests/modules/ads-third-party.test.ts`.
- **F02** — `tests/modules/ads-third-party.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/ads third-party tags. — screen file `app/(admin)/admin/ads/page.tsx`.
- **F05** — consent-gated tags plus /api/ads/third-party-consent; campaign config stays `ads.*` at /api/v1/ads.*. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/ads-third-party.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/ads-third-party.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/ads-third-party.test.ts` is the composition proof.

## C9.21 — Build the optional front-site assistant with AI adapters

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0147_front_site_assistant.sql`; table invariants asserted in `tests/modules/assistant.test.ts`.
- **F02** — `tests/modules/assistant.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/assistant.test.ts`.
- **F04** — /admin/assistant. — screen file `app/(admin)/admin/assistant/page.tsx`.
- **F05** — `assistant.answer`/`settings`/`updateSettings`/`turns` at /api/v1/assistant.* plus /api/chat/assistant, MCP `assistant_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/assistant.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/assistant.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/assistant.test.ts` is the composition proof.

## C9.22 — Ground the assistant from published content/catalog/hours/

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0148_assistant_grounding.sql`; table invariants asserted in `tests/modules/assistant-grounding.test.ts`.
- **F02** — `tests/modules/assistant-grounding.test.ts` — assistant grounding reads through the typed boundary with refusal.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/assistant grounding. — screen file `app/(admin)/admin/assistant/page.tsx`.
- **F05** — `assistant.knowledgeList`/`saveKnowledge`/`reindex`/`setScope`/`scopes` at /api/v1/assistant.*, MCP `assistant_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/assistant-grounding.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/modules/assistant-grounding.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/assistant-grounding.test.ts` is the composition proof.

## C9.23 — Prevent invented price/availability, enforce refusals and

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0149_assistant_guardrails.sql`; table invariants asserted in `tests/modules/assistant-guardrails.test.ts`.
- **F02** — `tests/modules/assistant-guardrails.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/assistant-guardrails.test.ts`.
- **F04** — /admin/assistant guardrails. — screen file `app/(admin)/admin/assistant/page.tsx`.
- **F05** — refusals live inside `assistant.answer` at /api/v1/assistant.answer; `assistant.replied`/`assistant.refused` fan out on the webhook bus. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/assistant-guardrails.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/assistant-guardrails.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/assistant-guardrails.test.ts` is the composition proof.

## C9.24 — Build social OAuth/adapters for Instagram, Facebook, TikTok

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0150_social_profiles.sql`; table invariants asserted in `tests/modules/social.test.ts`, `tests/adapters/social-conformance.test.ts`.
- **F02** — `tests/modules/social.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/social connections. — screen file `app/(admin)/admin/social/page.tsx`.
- **F05** — `social.beginOAuth`/`completeOAuth`/`assignProfile`/`disconnectProfile` at /api/v1/social.*, MCP `social_*`; callback /api/social/[provider]/callback. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/social.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/social.test.ts`, `tests/adapters/social-conformance.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/social.test.ts` is the composition proof.

## C9.25 — Ingest owned posts/media into canonical packages with rights

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0151_social_ingest.sql`; table invariants asserted in `tests/modules/social-ingest.test.ts`.
- **F02** — `tests/modules/social-ingest.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/social-ingest.test.ts`.
- **F04** — /admin/social ingest. — screen file `app/(admin)/admin/social/page.tsx`.
- **F05** — `social.ingestProfile`/`packageList`/`draftFromPackage`/`interactionList` at /api/v1/social.*, MCP `social_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/social-ingest.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/social-ingest.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/social-ingest.test.ts` is the composition proof.

## C9.26 — Build multi-platform composer/cross-pollination from authored

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0152_social_composer.sql`; table invariants asserted in `tests/modules/social-composer.test.ts`.
- **F02** — `tests/modules/social-composer.test.ts` — the social composer boundary: draft, validate and refuse.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/social composer. — screen file `app/(admin)/admin/social/page.tsx`.
- **F05** — `social.composePackage`/`createVariants`/`schedulePublications`/`publicationCalendar` at /api/v1/social.*, MCP `social_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/social-composer.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/modules/social-composer.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/social-composer.test.ts` is the composition proof.

## C9.27 — Sync Google Business Profile posts/hours/reviews and attribute

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0153_social_gbp.sql`; table invariants asserted in `tests/modules/social-gbp.test.ts`.
- **F02** — `tests/modules/social-gbp.test.ts` — GBP location posting through the typed social boundary.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/social-gbp.test.ts`.
- **F04** — /admin/social GBP. — screen file `app/(admin)/admin/social/page.tsx`.
- **F05** — `social.syncGbp`/`attributionReport` plus `reviews.ingestExternal` at /api/v1/social.* and /api/v1/reviews.ingestExternal, MCP `social_*`/`reviews_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/social-gbp.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/modules/social-gbp.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/social-gbp.test.ts` is the composition proof.

## C9.28 — Build universal `ShareTarget`, native/channel intents, generated

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0155_share_targets.sql`; table invariants asserted in `tests/modules/share.test.ts`.
- **F02** — `tests/modules/share.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/share.test.ts`.
- **F04** — /admin/sharing. — screen file `app/(admin)/admin/sharing/page.tsx`.
- **F05** — `share.targetFor`/`shareVia`/`saveTarget`/`resolveLink`/`linkReport` at /api/v1/share.*, MCP `share_*`; public `/share` and `/s/[ref]`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/share.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/share.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/share.test.ts` is the composition proof.

## C9.29 — Let a client share their proofing gallery with a partner

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0159_client_gallery_partner_share.sql`; table invariants asserted in `tests/core/gallery-partner-share.test.ts`.
- **F02** — `tests/core/gallery-partner-share.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/gallery-partner-share.test.ts`.
- **F04** — gallery partner share, not a new admin screen. — `tests/core/gallery-partner-share.test.ts`.
- **F05** — `galleries.invitePartner`/`revokePartner` at /api/v1/galleries.invitePartner and /api/v1/galleries.revokePartner, MCP `galleries_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/gallery-partner-share.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/gallery-partner-share.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/gallery-partner-share.test.ts` is the composition proof.

## C9.34 — Let a prospect share a quote internally before accepting

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0160_quote_partner_links.sql`; table invariants asserted in `tests/core/quote-partner-share.test.ts`.
- **F02** — `tests/core/quote-partner-share.test.ts` — partner quote sharing through the typed contract boundary.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/quote-partner-share.test.ts`.
- **F04** — quote internal share, not a new admin screen. — `tests/core/quote-partner-share.test.ts`.
- **F05** — `quotes.invitePartner`/`revokePartner`/`byPartnerToken` at /api/v1/quotes.*; `quotes.byPartnerToken` is MCP-excluded. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/quote-partner-share.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/quote-partner-share.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/quote-partner-share.test.ts` is the composition proof.

## C9.35 — Build gift-card/registry-style sharing on products

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0161_product_gift_share.sql`; table invariants asserted in `tests/core/product-gift-share.test.ts`.
- **F02** — `tests/core/product-gift-share.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/core/product-gift-share.test.ts`.
- **F04** — gift-card/registry public share `/gifts`. — `tests/core/product-gift-share.test.ts`.
- **F05** — `catalog.shareWishlist`/`catalog.sendGiftCard` at /api/v1/catalog.*, MCP `catalog_*`; public `/gifts` plus plugin `giftRegistry.*` when installed. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/product-gift-share.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/core/product-gift-share.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/product-gift-share.test.ts` is the composition proof.

## C9.36 — Emit copy-paste embed codes for galleries, review walls

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/core/embeds.test.ts`.
- **F02** — `tests/core/embeds.test.ts` — embed rendering boundaries with stable error and refusal paths.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — copy-paste embeds `/embed/*`. — `tests/core/embeds.test.ts`.
- **F05** — `share.embedSnippet` at /api/v1/share.embedSnippet, MCP `share_embedSnippet`; public `/embed/*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/embeds.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/core/embeds.test.ts`, `tests/core/csp.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/core/embeds.test.ts` is the composition proof.

## C9.30 — Build frequency-capped popups, announcement/exit-intent surfaces

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0157_popups.sql`; table invariants asserted in `tests/modules/popups.test.ts`, `tests/core/cms-a11y.test.ts`.
- **F02** — `tests/modules/popups.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/popups.test.ts`.
- **F04** — /admin/popups. — screen file `app/(admin)/admin/popups/page.tsx`.
- **F05** — `popups.save`/`decide`/`capture`/`list`/`setStatus`/`performance` at /api/v1/popups.*, MCP `popups_*`; public /api/popups. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/popups.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/popups.test.ts`, `tests/core/cms-a11y.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/popups.test.ts` is the composition proof.

## C9.31 — Enable the social connection/onboarding surface in normal

- **F01** — No item-dedicated migration is named in §43; schema is owned per-module and applied through `db/migrations/0000_reviewed-baseline.sql` (reviewed baseline, C10.19); database coverage in `tests/modules/social-onboarding.test.ts`.
- **F02** — `tests/modules/social-onboarding.test.ts` — social account onboarding through the typed boundary; conformance in `tests/adapters/social-conformance.test.ts`.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — /admin/social onboarding. — screen file `app/(admin)/admin/social/page.tsx`.
- **F05** — `social.beginOAuth` plus onboarding `social.networks` at /api/v1/social.*, MCP `social_*` (same OAuth as C9.24, onboarding entry). — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/social-onboarding.test.ts` covers validation and failure-mode refusal; scoped permission enforcement on the service boundary is proven for every service by `tests/core/api.test.ts` (C0.11 audit narrowing).
- **F08** — `tests/modules/social-onboarding.test.ts`, `tests/adapters/social-conformance.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/social-onboarding.test.ts` is the composition proof.

## C9.32 — Build scheduled exports and the accounting export shapes

- **F01** — `db/migrations/0000_reviewed-baseline.sql` — reviewed baseline (C10.19) folding the item's migration tag `0158_scheduled_exports.sql`; table invariants asserted in `tests/modules/reporting-exports.test.ts`.
- **F02** — `tests/modules/reporting-exports.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — `tests/core/merge-completeness.test.ts` — merge repointing is enforced by reflection over every module's tables, so any contact reference this item stores is covered; its contact-facing behaviour is exercised in `tests/modules/reporting-exports.test.ts`.
- **F04** — /admin/reports/exports. — screen file `app/(admin)/admin/reports/exports/page.tsx`.
- **F05** — `reports.saveExport`/`runExport`/`listExports`/`downloadExport`/`deliverScheduledExports` at /api/v1/reports.*, MCP `reports_*`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/reporting-exports.test.ts` covers permission, refusal and recovery.
- **F08** — `tests/modules/reporting-exports.test.ts` — the item's unit/service/database coverage.
- **F09** — N/A as C11.14 — this item uses the shared audit/outbox; product-wide export/restore/retention/erasure proof is still open. Shared audit/outbox participation it rides on: `tests/core/record-participation.test.ts`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/modules/reporting-exports.test.ts` is the composition proof.

## C9.33 — Build the automatic subscription billing modes — `provider`

- **F01** — Migration `0162_subscription_billing.sql` (`payment_method_id`, `pending_plan_id`). — `tests/modules/subscription-billing.test.ts`.
- **F02** — Orchestrators `enroll`, `changePlan`, `chargePlatformInvoice`, `attachProviderSchedule`, `cancelAgreement` — claim/apply services, no provider I/O under a service transaction. — `tests/modules/subscription-billing.test.ts`.
- **F03** — Money is still `invoicing` (`source_type = 'subscription'`); merge already repoints `subscriptions.contact_id`. — `tests/modules/subscription-billing.test.ts`.
- **F04** — Admin /admin/subscriptions billing-mode and proration fields, stored-method enroll, per-subscriber plan change; portal change-plan beside click-to- cancel. — screen file `app/(admin)/admin/subscriptions/page.tsx`.
- **F05** — The same services are the HTTP/MCP surface. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/modules/subscription-billing.test.ts`, Stripe adapter coverage in `tests/core/payment-adapters.test.ts`, transaction-boundary scan includes `billing.ts`.
- **F08** — `tests/modules/subscription-billing.test.ts`, `tests/core/payment-adapters.test.ts` — the item's unit/service/database coverage.
- **F09** — Apache-2.0 SPDX on the new files. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping). Changeset `subscription-billing.md` named in §43.
- **F12** — live provider settlement is C11.05, same honesty as C5.25 — user-facing copy is changeset `subscription-billing.md`. EN/FR/ES. — `tests/modules/subscription-billing.test.ts`.

## C10.01 — Enforce customization seams—database, plugins, configuration

- **F01** — N/A — no new tables.
- **F02** — N/A — no new tables.
- **F03** — N/A — no new tables.
- **F04** — Doctor, not a new admin screen (C10.11). — `tests/core/update-seams.test.ts`.
- **F05** — `platform.inspectSeams`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — doctor sentences are English operational copy.
- **F07** — anonymous callers refused; core edits are unsupported; production local-disk uploads fail. — `tests/core/update-seams.test.ts`.
- **F08** — `tests/core/update-seams.test.ts`, doctor ids in `tests/core/doctor.test.ts`.
- **F09** — doctor. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/customization-seams.md`, changeset `customization-seams.md`.
- **F12** — a plugin-dir edit does not change the core digest; a `src/` edit does. — `tests/core/update-seams.test.ts`.

## C10.02 — Implement semantic stable/security/edge channels and

- **F01** — N/A — tables are C10.11.
- **F02** — N/A — tables are C10.11.
- **F03** — N/A — tables are C10.11.
- **F04** — Doctor, not a new admin screen (C10.11). — `tests/core/update-release.test.ts`.
- **F05** — `platform.describeRelease`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — doctor sentences are English operational copy.
- **F07** — anonymous callers refused; a patch is not assumed compatible; security without CVSS is refused. — `tests/core/update-release.test.ts`.
- **F08** — `tests/core/update-release.test.ts`, doctor ids in `tests/core/doctor.test.ts`.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/release-channels.md`, changeset `release-channels.md`.
- **F12** — `canApplyFrom` uses minFromVersion, not the size of the version bump. — `tests/core/update-release.test.ts`.

## C10.03 — Publish signed `releases.json`, image digest/signature and

- **F01** — N/A — tables are C10.11.
- **F02** — N/A — tables are C10.11.
- **F03** — N/A — tables are C10.11.
- **F04** — Doctor, not a new admin screen (C10.11). — `tests/core/update-feed.test.ts`.
- **F05** — `platform.verifyReleaseFeed`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — doctor sentences are English operational copy.
- **F07** — anonymous callers refused; missing/tampered/unknown signatures refuse. — `tests/core/update-feed.test.ts`.
- **F08** — `tests/core/update-feed.test.ts`, doctor ids in `tests/core/doctor.test.ts`.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/release-feed.md`, changeset `signed-release-feed.md`.
- **F12** — a retiring key still verifies; an untrusted key does not. This is not unattended self-update — the daily check is C10.04. — `tests/core/update-feed.test.ts`.

## C10.04 — Build private daily update checks with jitter, no instance ID

- **F01** — N/A — tables are C10.11.
- **F02** — N/A — tables are C10.11.
- **F03** — N/A — tables are C10.11.
- **F04** — setup done + Doctor, not a new admin screen (C10.11). — `tests/core/update-check.test.ts`.
- **F05** — `platform.checkUpdates`, `platform.updateCheckPolicy`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — `setup.done.updateCheck` in en/es/fr. — `tests/core/update-check.test.ts`.
- **F07** — anonymous callers refused; off skips the GET; query parameters refused. — `tests/core/update-check.test.ts`.
- **F08** — `tests/core/update-check.test.ts`, doctor ids, `tests/core/outbox.test.ts` job registry.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/update-checks.md`, changeset `daily-update-check.md`.
- **F12** — the captured request has no instance identifier. This is not unattended apply — C10.06. — `tests/core/update-check.test.ts`.

## C10.05 — Build preflight: signatures, plugin compatibility, shadow-DB

- **F01** — N/A — tables are C10.11.
- **F02** — N/A — tables are C10.11.
- **F03** — N/A — tables are C10.11.
- **F04** — Doctor, not a new admin screen (C10.11). — `tests/core/update-preflight.test.ts`.
- **F05** — `platform.preflightUpdate`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — doctor sentences are English operational copy.
- **F07** — anonymous callers refused; unsigned feed fails; incompatible plugin is named. — `tests/core/update-preflight.test.ts`.
- **F08** — `tests/core/update-preflight.test.ts`, doctor ids.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/update-preflight.md`, changeset `update-preflight.md`.
- **F12** — shadow SQL `SELECT 1/0` fails migrations without touching `public`. This is not apply — C10.06. — `tests/core/update-preflight.test.ts`.

## C10.06 — Build snapshot → verify/pull → migrate → health/smoke → cutover

- **F01** — `update_snapshots`, `update_runs`, `release_notes`. — `tests/core/update-apply.test.ts`.
- **F02** — no `contact_id`. — `tests/core/update-apply.test.ts`.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — list service, not a new admin screen (C10.11). — `tests/core/update-apply.test.ts`.
- **F05** — `platform.applyUpdate`, `platform.listUpdateRuns`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — note title is English operational copy.
- **F07** — anonymous refused; failed smoke rolls back and writes no note. — `tests/core/update-apply.test.ts`.
- **F08** — `tests/core/update-apply.test.ts`.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/update-apply.md`, changeset `update-apply.md`.
- **F12** — `failAt: "smoke"` yields `rolled_back`. — `tests/core/update-apply.test.ts`.

## C10.31 — Verified Docker host update lane

- **F01** — Root-private filesystem state and PostgreSQL dumps; no new application schema. `scripts/docker-updater.py`.
- **F02** — `src/core/update/host.ts` exposes bounded status/apply contracts over a private Unix socket.
- **F03** — N/A — infrastructure operations do not introduce another customer identity or contact record.
- **F04** — `app/(admin)/admin/updates/page.tsx` displays independent host status, limitations and an owner apply action.
- **F05** — Root CLI and systemd timer; browser controls intentionally excluded from API-key/MCP projections in `tests/core/internal-services.test.ts`.
- **F06** — Host card strings in en/fr/es/ar; operational CLI documentation is English. `locales/en.json`, `deploy/docker-selfhost/docker-updater/README.md`.
- **F07** — `tests/core/playground.test.ts` checks the fresh-owner-factor boundary. Python host drills prove refusal before cutover and verified recovery, including interrupted-run blocking.
- **F08** — Host state-machine tests plus a real isolated restored-backup rehearsal; the item stays open until live deployment and recovery evidence are recorded. `tests/host/test_docker_updater.py`, `.github/workflows/ci.yml`.
- **F09** — Real backups and exact configs retained with root-only access; operator retention policy required. `deploy/docker-selfhost/docker-updater/README.md`.
- **F10** — N/A — the public playground explicitly cannot operate the host updater; ordinary installations opt in separately.
- **F11** — `deploy/docker-selfhost/docker-updater/README.md` documents supported shape, scheduling, manual migration boundary and recovery.
- **F12** — Signature verification, restored-backup boot, unchanged-schema gate, maintenance and health-checked image recovery are composed by the host executor; no Docker socket in the web app. `scripts/docker-updater.py`.
## C10.07 — Enforce N-1 schema readability in migrations and prove update

- **F01** — N/A — no tables of its own — the schema state it reads belongs to the host's operational tables.
- **F02** — N/A — no typed service boundary of its own — it composes or validates existing services.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — Doctor `update.n1`. — `tests/core/schema-compat-gate.test.ts`.
- **F05** — N/A — CI gate.
- **F06** — N/A — no human surface — operational or CI output only, so there is nothing to translate or scan.
- **F07** — compatible + acknowledged break refuses. — `tests/core/schema-compat-gate.test.ts`.
- **F08** — `tests/core/schema-compat-gate.test.ts`, `tests/core/upgrade-gate.test.ts`.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/n1-schema.md`, changeset `n1-schema.md`.
- **F12** — live `this-release.ts` reads as compatible. — `tests/core/schema-compat-gate.test.ts`.

## C10.08 — Build update policy/windows in business timezone, security-

- **F01** — `update_settings`. — `tests/core/update-policy.test.ts`.
- **F02** — no `contact_id`. — `tests/core/update-policy.test.ts`.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — Doctor `update.policy`, not a new admin screen (C10.11). — `tests/core/update-policy.test.ts`.
- **F05** — the three services. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface — operational or CI output only, so there is nothing to translate or scan.
- **F07** — anonymous refused; paused/off/outside window do not auto-apply; stable needs approval under security-auto. — `tests/core/update-policy.test.ts`.
- **F08** — `tests/core/update-policy.test.ts`.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/update-policy.md`, changeset `update-policy.md`.
- **F12** — Tuesday 03:00 America/Vancouver is in-window, Monday is not. — `tests/core/update-policy.test.ts`.

## C10.09 — Build fork-lane upstream merge/worktree/gates/PR, drift and

- **F01** — no schema — drift is computed, never stored; `AvailableRelease` caching stays with C10.11. — `tests/core/update-fork.test.ts`.
- **F02** — `platform.forkStatus` / `openForkUpdate` are orchestrated, so no transaction is held across git or GitHub I/O. — `tests/core/update-fork.test.ts`.
- **F03** — N/A — no `contact_id`.
- **F04** — Doctor `update.fork`, not a new admin screen (C10.11). — `tests/core/update-fork.test.ts`.
- **F05** — the two services. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — operational copy is English.
- **F07** — anonymous refused; refs and remotes are validated before git is spawned with `shell: false`; the running tree is never written and the base branch is never pushed to. — `tests/core/update-fork.test.ts`.
- **F08** — `tests/core/update-fork.test.ts` proves the seam refusal, the channel- filtered security count, the abort-and-remove, and that no `commit` or `push` is ever run.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — a fork is not seeded.
- **F11** — `deploy/fork-lane.md`, changeset `fork-lane.md`.
- **F12** — a fork three commits ahead and two security releases behind reports "2 security releases behind — CVSS 8.1; this fork carries 3 commits of its own". — `tests/core/update-fork.test.ts`.

## C10.10 — Implement and continuously test target-specific update/

- **F01** — N/A — no schema change in this item.
- **F02** — no `contact_id`; `applyUpdate` was already orchestrated. — `tests/core/update-targets.test.ts`.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — Doctor `update.target`, which warns when no recipe is declared because an update that swaps nothing still looks like it worked; the admin screen is C10.11. — `tests/core/update-targets.test.ts`.
- **F05** — `platform.describeUpdateTargets`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — no human surface — operational or CI output only, so there is nothing to translate or scan.
- **F07** — anonymous refused; an unknown recipe name resolves to the stub rather than a guessed strategy; a target with no rollback command refuses instead of pretending. — `tests/core/update-targets.test.ts`.
- **F08** — `tests/core/update-targets.test.ts` proves each recipe implements what it declares and that the embedded copy cannot drift from `recipe.yaml`.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/update-targets.md`, changeset `update-targets.md`.
- **F12** — `scripts/recipe-update-actions.mjs` runs once per target inside the recipe matrix, so §39.8's "a recipe without a tested update path is not Tier 1" is enforced on every PR.

## C10.11 — Build the update read model §39.10 specifies: cache the

- **F01** — `available_releases`, unique on version, with database checks repeating the feed parser's rule that a scored release names a band and an unscored one does not. — `tests/core/update-catalog.test.ts`.
- **F02** — no `contact_id`; the cache is written in a fresh transaction after `checkUpdates` finishes its network call, never one held across it. — `tests/core/update-catalog.test.ts`.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — as a Doctor check "not a new admin screen (C10.11)". One item cannot be the deferred F04 of ten. The four parts are C10.11 and C10.20–C10.22; they keep those numbers because §43 identifiers are referenced from source, tests and the packaged template, and renumbering live IDs to make a document read in order trades a real breakage for a cosmetic one. They are printed here, in dependency order, rather than at the end of C10. — `tests/core/update-catalog.test.ts`.
- **F05** — `platform.updateStatus`, `platform.listAvailableReleases`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — operational copy.
- **F07** — anonymous refused; `unknown` is a distinct posture so an unchecked instance is never told it is up to date; a withdrawn CVSS is corrected by upsert rather than retained. — `tests/core/update-catalog.test.ts`.
- **F08** — `tests/core/update-catalog.test.ts`.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/update-status.md`, changeset `update-status.md`.
- **F12** — §39.11's rollback horizon is computed from the newest breaking release the instance has passed, and per-row applicability reuses C10.02's `canApplyFrom`. — `tests/core/update-catalog.test.ts`.

## C10.20 — Build the admin update surface §39.10 requires: a status line

- **F01** — no schema — reads C10.11's. — `tests/core/update-admin.test.ts`.
- **F02** — every action calls the existing services; the admin is a caller, never a shortcut. — `tests/core/update-admin.test.ts`.
- **F03** — N/A — no `contact_id`.
- **F04** — of C10.01–C10.10 is discharged, including the policy editor for C10.08's window, channel, pause and retention, and the fork lane's drift and missing-security view from C10.09. *(`app/(admin)/admin/updates/page.tsx` and `updateControlAction`. Status line tone follows posture, with `behind-security` in the danger colour and `unknown` shown rather than hidden.
- **F05** — unchanged — the same services the CLI (C10.21) and MCP (C10.22) will call. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — all strings in `en`/`es`/`fr`; colours are semantic tokens only, so it ships in light and dark; /admin/updates is in the real-browser accessibility sweep. — `tests/core/update-admin.test.ts`.
- **F07** — `requireStaffActor("platform")`; apply confirms before cutting over; pause and resume are the policy save with one field changed rather than a second write path. — `tests/core/update-admin.test.ts`.
- **F08** — `tests/core/update-admin.test.ts` and the a11y step.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — the no-deploy-target warning says plainly that an update would swap nothing. — `tests/core/update-admin.test.ts`.
- **F11** — `deploy/update-admin.md`, changeset `update-admin.md`.
- **F12** — the fork panel appears only on a git checkout, and the target panel marks which of the six recipes this instance is. — `tests/core/update-admin.test.ts`.

## C10.21 — Ship the `freeholder update` CLI: `--check`, `--preflight`

- **F01** — N/A — no schema change in this item.
- **F02** — orchestrated; the refusal is a `conflict` error, not a silent no-op. — `tests/core/update-cli.test.ts`.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — the admin equivalent is C10.20. — `tests/core/update-cli.test.ts`.
- **F05** — this is the CLI surface; MCP is C10.22. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — operational copy in English.
- **F07** — scoped API key is the documented cron credential, so a monitoring key need not be able to cut a site over; TOTP supported for owner sessions. — `tests/core/update-cli.test.ts`.
- **F08** — `tests/core/update-cli.test.ts` pins every exit code and proves the CLI holds no database or deploy logic.
- **F09** — SPDX; built and linted with the other published packages. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — `packages/cli/README.md`.
- **F11** — changeset `update-cli.md`. — `tests/core/update-cli.test.ts`.
- **F12** — a rolled-back apply exits non-zero, so cron cannot mistake a reversal for a success. — `tests/core/update-cli.test.ts`.

## C10.22 — Expose the same services as MCP tools and add the §39.10

- **F01** — no new table; the topic `platform.securityUpdate` joins `NOTIFICATION_TOPICS`. — `tests/core/update-escalation.test.ts`.
- **F02** — the decision is pure and separately tested; delivery is one transaction. — `tests/core/update-escalation.test.ts`.
- **F03** — notifications resolve their recipient through the existing spine helper. — `tests/core/update-escalation.test.ts`.
- **F04** — the notification links to /admin/updates (C10.20). — screen file `app/(admin)/admin/updates/page.tsx`.
- **F05** — MCP tools plus the notification itself — the fourth §39.10 surface. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — N/A — operational copy.
- **F07** — a key scoped `platform.updateStatus` is refused `platform.applyUpdate`, so a monitoring key cannot cut a site over; escalation continues while updates are paused, because §39.6's pause was only safe on the condition the platform still says you are exposed. — `tests/core/update-escalation.test.ts`.
- **F08** — `tests/core/update-escalation.test.ts`.
- **F09** — SPDX; the job is observable and retryable like every other. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/update-escalation.md`, changeset `update-escalation.md`.
- **F12** — the key is bucketed by version and day, so an hourly job escalates once daily and a newer release still gets its own alarm. — `tests/core/update-escalation.test.ts`.

## C10.12 — Create the Expo/React Native package entirely against the

- **F01** — N/A — no schema change in this item.
- **F02** — discovery is a public route that says nothing a signed-out visitor could not read. — `tests/core/mobile-app.test.ts`.
- **F03** — N/A — the app holds no contact of its own; `DeviceToken` arrives with C10.14.
- **F04** — the screens are C10.13. — `tests/core/mobile-app.test.ts`.
- **F05** — the package is a client of the generated SDK and the existing HTTP API; no mobile-only endpoint was added beyond discovery itself. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — locale, currency and timezone come from the instance rather than the device. — `tests/core/mobile-app.test.ts`.
- **F07** — https enforced; a failed biometric locks the screen without signing out; an app newer than its instance is not locked out. — `tests/core/mobile-app.test.ts`.
- **F08** — `tests/core/mobile-app.test.ts`, which also asserts structurally that the package imports nothing but its own files and node builtins, so it cannot grow a rule that goes stale during store review.
- **F09** — SPDX; built, linted and artifact-gated with the other packages. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — `packages/mobile-app/README.md`.
- **F11** — changeset `mobile-app-package.md`; §35's MIT parenthetical corrected to Apache-2.0, which is what C0.10, `LICENSING.md` and the licence gate all require. — `tests/core/mobile-app.test.ts`.
- **F12** — the app's compatibility check and the server's `checkCompatibility` are asserted to agree. — `tests/core/mobile-app.test.ts`.

## C10.13 — Build the app's screen contracts, navigation and deep links

- **F01** — N/A — no schema change in this item.
- **F02** — no service changes — the contract names existing ones. — `tests/core/mobile-screens.test.ts`.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — every screen carries a title and an empty-state key, so no screen can render blank; the views are C10.23/C10.24. — `tests/core/mobile-screens.test.ts`.
- **F05** — the contract *is* the agent-visible surface: `servicesUsed()` is exactly the scope an app's API key needs. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — locale prefixes are stripped, so `/fr/portal/...` and /portal/... are one destination. — `tests/core/mobile-screens.test.ts`.
- **F07** — a link resolves to a screen and one opaque parameter and nothing else — query strings are dropped, a link for another instance is refused rather than silently switching business, and non-http schemes are rejected. — `tests/core/mobile-screens.test.ts`.
- **F08** — `tests/core/mobile-screens.test.ts`, 26 tests, including one that checks every declared service against the generated SDK — it caught fourteen invented names in the first draft.
- **F09** — SPDX. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — changeset `mobile-screens.md`. — `tests/core/mobile-screens.test.ts`.
- **F12** — every push link round-trips through the resolver back to the screen that minted it. — `tests/core/mobile-screens.test.ts`.

## C10.23 — Stand up the runnable Expo application against the screen

- **F01** — N/A — no schema change in this item.
- **F02** — no services; the app calls /api/v1/<service>, the same surface the website, CLI and MCP use. — `tests/core/mobile-screens.test.ts`.
- **F03** — N/A — the app holds no contact of its own.
- **F04** — connect, home and catalog, each with loading, empty and error states, and cached content that says when it was fetched. The catalog and product contracts read `catalog.listVisibleProducts` and `catalog.resolveVisibleProduct`, the public projections: the first draft named `catalog.listProducts`, a registered name — so the C10.13 SDK check passed — and an owner-only service, so every customer would have seen the error state. `tests/core/mobile-screens.test.ts` now boots the registry and refuses a public screen that reads anything but a public or authenticated service; the same assertion must extend to the signed-in screens as C10.24 builds them, because four of their contracts have the same defect.
- **F05** — N/A — this is a human client of the existing agent surface.
- **F06** — locale, currency and timezone come from the instance; colours come from its semantic tokens, so a rebrand needs no store review. — `tests/core/mobile-screens.test.ts`.
- **F07** — the session is in the platform keychain via `expo-secure-store`, never JS-reachable storage. — `tests/core/mobile-screens.test.ts`.
- **F08** — `tests/core/mobile-app-shell.test.ts`, plus the app's own typecheck in CI.
- **F09** — one dedicated CI job, so the React Native graph is not billed to the other twenty. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — `apps/mobile/README.md`.
- **F11** — changeset `expo-customer-app.md`. — `tests/core/mobile-screens.test.ts`.
- **F12** — the tab bar renders `TAB_ORDER` filtered to screens that exist, so a tab never leads to a dead end. Store binaries are C10.16. — `tests/core/mobile-screens.test.ts`.

## C10.24 — Make the signed-in screen contracts true before building on

- **F01** — N/A — no schema.
- **F02** — existing platform permissions remain intact; contracts require customer-callable queries/mutations of the declared kind. — `tests/core/mobile-screens.test.ts`.
- **F03** — existing portal/contact services supply identity and records; no new customer model. — `tests/core/mobile-screens.test.ts`.
- **F04** — N/A — no new screen; existing home/catalog/tab copy resolves labels, and home reads the actual portal-room array.
- **F05** — N/A — no new platform API.
- **F06** — all contract title/empty keys plus shared loading/retry labels resolve in en/es/fr; generated app-only catalogs are checked against their source, with regional/default/unknown-key tests. No colors or accessibility roles change. — `tests/core/mobile-screens.test.ts`.
- **F07** — `useScreenWrite` checks the declared write and signed-in caller, refuses known-offline submissions before transport, and neither caches nor retries writes; duplicate taps are guarded. Read dependencies use stable caller values to avoid render/refetch loops. — `tests/core/mobile-screens.test.ts`.
- **F08** — 78 focused mobile/locale tests, Expo typecheck, package build and full fast gates; mobile audience and shell checks now run in the fast gates. — `tests/core/mobile-screens.test.ts`.
- **F09** — N/A — no jobs or persistent storage; gallery cache persistence and revocation remain C10.27. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — existing tabs display translated labels rather than keys; no new setup is required. — `tests/core/mobile-screens.test.ts`.
- **F11** — §35.1, both app READMEs, generator and `customer-mobile-contracts.md` changeset. — `tests/core/mobile-screens.test.ts`.
- **F12** — shell test restricts the write assertion to the shared helper and refuses direct transport from screens. Native screen/device journeys remain C10.25–C10.28; this item delivers their contract and write foundation. — `tests/core/mobile-screens.test.ts`.

## C10.29 — Supply C10.27's customer gallery foundation: a contact-bound

- **F01** — no schema changes; existing gallery/contact and guest/gallery/contact indexes support the query. — `tests/core/customer-galleries.test.ts`.
- **F02** — portal and API share that query; gallery login and image access keep the existing service authorization. — `tests/core/customer-galleries.test.ts`.
- **F03** — portal and API share that query; gallery login and image access keep the existing service authorization. — `tests/core/customer-galleries.test.ts`.
- **F04** — the generic portal supplies list, empty and failed-room states. — `tests/core/customer-galleries.test.ts`.
- **F05** — HTTP/OpenAPI/SDK and normal agent discovery expose the contact-bound query. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — en/es/fr room labels reuse the portal's semantic light/dark UI; browser assertions cover all six views. That browser audit found missing document titles on generic portal rooms; the shared page now generates its translated room title. — `tests/core/customer-galleries.test.ts`.
- **F07** — expired/revoked invitations disappear; explicit image bearer failure never falls back to cookies, and the slug is checked inside `viewItem`. Header-authenticated images are no-store; browser cookies retain the existing 60-second cache limit. — `tests/core/customer-galleries.test.ts`.
- **F08** — customer/owner-grant isolation, guest expiry, private image bytes, cookie precedence, wrong slug, hidden items, missing watermarks and expiry have integration tests; the browser journey follows portal → gallery → login. — `tests/core/customer-galleries.test.ts`.
- **F09** — no jobs or storage changes; existing gallery privacy, merge and retention apply. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — the website gets the same room before the native tab. — `tests/core/customer-galleries.test.ts`.
- **F11** — generated SDK, app README and changeset updated. The 17 focused tests in `tests/core/customer-galleries.test.ts` and `tests/core/portal-rooms.test.ts` passed, as did 190 required contract tests. Browser validation and the merge queue passed in PR #332, merged as `c786e7680acb4eb87a79109a661731f20e8bceee`.
- **F12** — customer/owner-grant isolation, guest expiry, private image bytes, cookie precedence, wrong slug, hidden items, missing watermarks and expiry have integration tests; the browser journey follows portal → gallery → login. — `tests/core/customer-galleries.test.ts`.

## C10.14 — Build push registration/preferences and booking, gallery

- **F01** — `device_tokens`, with `contract_version` so a push is never sent to a binary too old to open its own C10.13 deep link. — `tests/core/merge-completeness.test.ts`.
- **F02** — repointed in `contacts.merge`; the plain repoint is safe *because* the unique index is on the token alone, so the survivor cannot already hold the moved row. — `tests/core/merge-completeness.test.ts`.
- **F03** — registered for merge, export and erasure — export includes the token because it is the customer's, and erasure deletes rather than revokes because a revoked row still holds a way to reach their phone. `tests/core/merge-completeness.test.ts` failed on all three the moment the table appeared, which is what it is for.
- **F04** — `notifications.myDevices` lists which phones can reach a customer and never returns the token itself. — `tests/core/merge-completeness.test.ts`.
- **F05** — three services. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — the message is whatever the notification already localized. — `tests/core/merge-completeness.test.ts`.
- **F07** — revoke is scoped to the caller's own tokens, because a token is a bearer value and guessing one must not silence somebody else. — `tests/core/merge-completeness.test.ts`.
- **F08** — `tests/core/push-devices.test.ts`.
- **F09** — delivery skips are recorded, never faked. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no setup, seed or demo surface of its own — the capability runs against an already-configured instance.
- **F11** — `deploy/push-notifications.md`, changeset `push-notifications.md`.
- **F12** — the four topics join `NOTIFICATION_TOPICS` rather than forming a mobile-only list, so they reach email and in-app under the same per-topic preferences — "a push that says something the platform would not have emailed is a bug". Honest limit: no production push carrier is configured yet; the adapter seam reports itself unavailable. — `tests/core/merge-completeness.test.ts`.

## C10.15 — Implement `freeholder-app init`: pull branding, generate

- **F01** — N/A — no schema change in this item.
- **F02** — N/A — reads the public discovery document.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — the command itself plus `packages/freeholder-app/README.md`.
- **F05** — N/A — operational CLI, not an agent tool; discovery is already public.
- **F06** — N/A — operational copy in English, like `freeholder update`.
- **F07** — https except loopback; logo GET is same-origin and 1 MiB-capped; no store secrets required or written. — `tests/core/freeholder-app-init.test.ts`.
- **F08** — `tests/core/freeholder-app-init.test.ts` with injected fetch (logo pixels, Bench tokens, env, non-JSON exit 2).
- **F09** — SPDX; built, linted and artifact-gated with the other packages. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — `packages/freeholder-app/README.md`, `apps/mobile/README.md`.
- **F11** — changeset `freeholder-app-init.md`. — `tests/core/freeholder-app-init.test.ts`.
- **F12** — packed `freeholder-app init` against an unreachable URL exits 3. Store binaries and review checklists remain C10.16. — `tests/core/freeholder-app-init.test.ts`.

## C10.16 — Continuously build iOS/Android against the demo contract and

- **F01** — N/A — no schema change in this item.
- **F02** — N/A — reads the public discovery document the app already parses.
- **F03** — N/A — no contact or money surface — operational records carry no contact_id, so there is nothing to repoint or converge.
- **F04** — the two store checklists. — `tests/core/mobile-store-gate.test.ts`.
- **F05** — N/A — operational CI, not an agent tool.
- **F06** — N/A — operational copy in English, like `freeholder update`.
- **F07** — the privacy manifest must match requested permissions; no tracking, no background location, no third-party analytics SDK. — `tests/core/mobile-store-gate.test.ts`.
- **F08** — `tests/core/mobile-store-gate.test.ts`.
- **F09** — the customer-app job, plus skippable `eas.yml`. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — `deploy/app-store-privacy.md`, `deploy/play-data-safety.md`, `apps/mobile/README.md`.
- **F11** — changeset `mobile-store-ci.md`. — `tests/core/mobile-store-gate.test.ts`.
- **F12** — every CI run exports iOS and Android against the demo contract. — `tests/core/mobile-store-gate.test.ts`.

## C10.19 — Collapse the migration chain into one reviewed baseline once

- **F01** — `db/migrations/0000_reviewed-baseline.sql` IS the reviewed baseline; `scripts/schema-baseline-identity.mjs` proves a fresh baseline apply is structurally identical to the pre-collapse chain via `tests/fixtures/c1019-chain.catalog`.
- **F02** — N/A — a migration-chain operation, not a service contract.
- **F03** — N/A — no spine touchpoint; it rewrites how schema is applied, not what records exist.
- **F04** — N/A — no new human surface; Doctor `update.n1` warns that rollback is a restore.
- **F05** — N/A — no new agent surface.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — `-- freeholder:schema-breaking` on the baseline plus `schemaRisk: "breaking"` in `src/core/update/this-release.ts`; the unattended updater refuses it.
- **F08** — `tests/core/schema-baseline-identity.test.ts` + `tests/core/migrate.test.ts` — baseline identity and migrate coverage.
- **F09** — `deploy/n1-schema.md`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `scripts/schema-baseline-identity.mjs` (and `tests/core/schema-baseline-identity.test.ts`) applies the chain from the git parent of the `0000_core-spine.sql` deletion and this baseline to empty databases, diffs catalogs after normalizing drizzle `*_id_*_id_fk` names, and compares against `tests/fixtures/c1019-chain.catalog`; `db:migrate` from empty; seed/demo load; §23 ownership drill still the restore path. Changeset `schema-baseline.md`.

## C11.01 — Prove site visitor → localized signup/page → optional consent-

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — public localized page, portal quote/agreement/invoice, admin inbox/task/quote/payments/contact/reports. — `tests/browser/c11-01-visitor-to-paid.spec.ts`.
- **F05** — `quotes.setConversion` via /api/v1, plus forms/chat/quotes/contracts/ invoicing. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — consent-safe import, C5.25 token, form stamp. — `tests/browser/c11-01-visitor-to-paid.spec.ts`.
- **F08** — `tests/browser/c11-01-visitor-to-paid.spec.ts`, `tests/core/signup-contact-import.test.ts` — the item's unit/service/database coverage.
- **F09** — mail outbox + invoice jobs. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — the Playwright chain. Hosted Stripe/PayPal settlement is not claimed; C5.25's manual/offline path is the customer pay step. — `tests/browser/c11-01-visitor-to-paid.spec.ts`.

## C11.02 — Prove product browse → variant/price/tax/stock → cart → mixed

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — not claimed as screens — this file is the catalog/invoicing services. — `tests/core/c11-02-catalog-journey.test.ts`.
- **F05** — catalog and invoicing services already in the contract. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — idempotent checkout, restock on RMA. — `tests/core/c11-02-catalog-journey.test.ts`.
- **F08** — `tests/core/c11-02-catalog-journey.test.ts` — the item's unit/service/database coverage.
- **F09** — existing fulfillment/refund jobs. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — the vitest chain. No public storefront cart UI; checkout is the catalog service. Manual adapter doubles stand in for live charges. — `tests/core/c11-02-catalog-journey.test.ts`.

## C11.03 — Prove service/event/rental discovery → real availability →

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — `tests/core/c11-03-booking-journey.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — not claimed as screens — `/embed/booking` remains a CTA. — `tests/core/c11-03-booking-journey.test.ts`.
- **F05** — bookings/waitlist/events/rentals/reviews/loyalty/invoicing. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — waitlist token is single-use; waiver is a signed snapshot. — `tests/core/c11-03-booking-journey.test.ts`.
- **F08** — `tests/core/c11-03-booking-journey.test.ts` — the item's unit/service/database coverage.
- **F09** — reminder job. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — the vitest chain. — `tests/core/c11-03-booking-journey.test.ts`.

## C11.04 — Prove phone/screen capture → interrupted/resumed Asset ingest →

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — capture page, gallery unlock. — `tests/browser/c11-04-capture.spec.ts`.
- **F05** — media/galleries/social/referrals services. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — capture session, gallery PIN, referral cookie claim. — `tests/browser/c11-04-capture.spec.ts`.
- **F08** — `tests/browser/c11-04-capture.spec.ts`, `tests/core/c11-04-gallery-social-journey.test.ts` — the item's unit/service/database coverage.
- **F09** — existing media/social jobs. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — the mixed chain. Remaining honesty: the Playwright Asset is not the printed one; live multi-network publish and shadow-media proof are not claimed. — `tests/browser/c11-04-capture.spec.ts`.

## C11.05 — Prove subscription/pass/retainer → entitlement → server-side

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — `tests/core/c11-05-subscription-journey.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — not claimed as screens — portal services are what this file calls. — `tests/core/c11-05-subscription-journey.test.ts`.
- **F05** — subscriptions and entitlements. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — cancelMine/changeMine are session-bound to the caller's contact. — `tests/core/c11-05-subscription-journey.test.ts`.
- **F08** — `tests/core/c11-05-subscription-journey.test.ts` — the item's unit/service/database coverage.
- **F09** — dunning/renew jobs. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — the vitest chain. **LIVE Stripe/PayPal settlement remains this item's remaining honesty** — adapter doubles and the manual ledger are what this proof runs; it is not a claimed hop and does not fake a live charge. — `tests/core/c11-05-subscription-journey.test.ts`.

## C11.06 — Prove prompt → agent proposal → approval → safe service calls

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — `tests/core/c11-06-agent-journey.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — not claimed as screens. — `tests/core/c11-06-agent-journey.test.ts`.
- **F05** — agents and builder services. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — approval inbox once-only, code isolation, content rollback. — `tests/core/c11-06-agent-journey.test.ts`.
- **F08** — `tests/core/c11-06-agent-journey.test.ts` — the item's unit/service/database coverage.
- **F09** — run inspection. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — the vitest chain. GitHub PR delivery still needs a connected repository — remaining honesty, not a claimed hop. — `tests/core/c11-06-agent-journey.test.ts`.

## C11.07 — Prove connected mail/calendar → contact/busy time → scheduled

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — N/A — no service layer in this item — planning, legal or CI text, not a typed service.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — not claimed as screens. — `tests/core/c11-07-mail-calendar-journey.test.ts`.
- **F05** — connections/mail/playbook/briefing services. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — Shared gates only, no per-item scan claimed: `tests/core/i18n-gate.test.ts` (every key in every shipped locale) + `tests/core/locale-quality.test.ts`; axe WCAG over the surfaces the browser suite visits in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/c11-07-mail-calendar-journey.test.ts` — untrusted `input_trust` handling (task inputTrust stays "untrusted") and the busy-union shape redaction (only {startsAt, endsAt}, no event titles).
- **F08** — `tests/core/c11-07-mail-calendar-journey.test.ts` — the item's unit/service/database coverage.
- **F09** — briefing assembly job. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — Partial, honestly labelled: site-wide demo, defaults and first-run guidance ride `tests/core/seed-demo.test.ts`; per-item contextual help is not separately evidenced.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — the vitest chain. OAuth/providers are mocked — no live Google/Microsoft session. — `tests/core/c11-07-mail-calendar-journey.test.ts`.

## C11.08 — Prove both fresh install → role-guided productive demo and

- **F01** — N/A — the journey exercises existing tables; it adds no schema.
- **F02** — `tests/core/c11-08-install-update-journey.test.ts` — install, import, export, signed apply and rollback through the typed services.
- **F03** — `tests/core/c11-08-install-update-journey.test.ts` — imported pages and demo records land on the CMS/contact spine.
- **F04** — `tests/browser/demo-scenarios.spec.ts` — role-guided demo load/reload/reset/purge in the real browser.
- **F05** — `tests/core/c11-08-install-update-journey.test.ts` — ownership export and signed apply driven through the service layer.
- **F06** — N/A — exercises existing surfaces; no new strings of its own.
- **F07** — `tests/core/c11-08-install-update-journey.test.ts` — `failAt: "smoke"` rollback restores the original CMS page.
- **F08** — `tests/browser/demo-scenarios.spec.ts` + `tests/core/c11-08-install-update-journey.test.ts`.
- **F09** — `tests/core/ownership-export.test.ts` + `scripts/ownership-drill.mjs` — export/restore pair matrix; restore on a second live Tier-1 target remains open.
- **F10** — `tests/core/seed-demo.test.ts` — the role-guided demo IS the seeded first-run experience this item proves.
- **F11** — `MASTER.md` §43 annotation this row transcribes. — `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — Open — restore on another Tier-1 target is the ownership-drill pair matrix, not yet a second live instance; everything else composes in the two suites above (`tests/core/ownership-export.test.ts` is the export/restore matrix).

## C11.09 — Run every F01–F12 criterion across every core/module/plugin/

- **F01** — N/A — the matrix runs criteria across plan rows; it adds no schema.
- **F02** — N/A — not a service item.
- **F03** — `tests/core/record-participation.test.ts` — the spine-participation proof rows cite when they defer F09 to C11.14.
- **F04** — N/A — an evidence artifact, not a screen; per-row F04 cells cite the screens.
- **F05** — N/A — the audit of agent surfaces, not a new one; per-row F05 cells cite `tests/core/api.test.ts`, `tests/core/sdk-schema.test.ts` and `tests/core/mcp.test.ts`.
- **F06** — N/A — no human surface.
- **F07** — `scripts/f-matrix.mjs` + `tests/core/f-matrix.test.ts` — refuses empty cells, unresolvable citations and lazy N/A.
- **F08** — `tests/core/f-matrix.test.ts` — the matrix checker suite.
- **F09** — `scripts/f-matrix.mjs` runs inside `pnpm gates` (via `scripts/fast-gates.mjs`).
- **F10** — N/A — no owner/staff/customer UI.
- **F11** — `deploy/f-criteria-matrix.md` (this document) + changeset `f-matrix-2026-09-16.md`.
- **F12** — `tests/core/f-matrix.test.ts` — one call validates the matrix against the whole live plan, the tracked tree and the suite glob.

## C11.10 — Complete independent security review of auth, payments

- **F01** — N/A — a review item; it adds no schema.
- **F02** — N/A — it reviews existing services; the inventory is `security/independent-review-packet.md`.
- **F03** — N/A — no new spine surface.
- **F04** — N/A — no screen.
- **F05** — N/A — it reviews existing agent surfaces.
- **F06** — N/A — no human surface.
- **F07** — `security/project-audit-2026-09-13.md` — the 2026-09-13/14 findings and repairs (community identity, agent proposals, capture authorization, search scope, provider fixtures, notes visibility); the independent review itself remains open.
- **F08** — `tests/core/community-rooms.test.ts` + `tests/core/c11-14-search.test.ts` + `tests/core/plugin-provider-boundary.test.ts` + `tests/core/catalog-orders.test.ts` — the repaired regression suites.
- **F09** — N/A — a review-process item with no operational surface of its own.
- **F10** — N/A — no owner/staff/customer UI.
- **F11** — `security/independent-review-packet.md` — threat surfaces, existing tests and known residuals.
- **F12** — N/A — a review is not a composed product journey.

## C11.11 — Meet defined performance budgets on seeded small/medium/large

- **F01** — `tests/helpers/performance.ts` — the seeded fixture inserts and counts all five declared record families (the audit repair).
- **F02** — `scripts/performance-budgets.mjs` — the runner requires a disposable database and a passing seeded measurement.
- **F03** — N/A — measurement tooling; fixture rows are cleaned up, nothing joins the spine.
- **F04** — N/A — no screen; it measures existing lists and the editor.
- **F05** — N/A — no agent surface.
- **F06** — N/A — no human surface.
- **F07** — `scripts/performance-budgets.mjs` + `tests/core/performance-budgets.test.ts` — NaN/infinity/negative timings and skipped databases fail (the audit repair).
- **F08** — `tests/core/performance-budgets.test.ts` — runner plus regressions for missing database, bad clocks and missing requested data.
- **F09** — `deploy/performance-measurements.md` — the measurement record, commands and limitations.
- **F10** — N/A — measurement tooling, not a setup surface.
- **F11** — `deploy/performance-measurements.md` + the §43 annotation this row transcribes.
- **F12** — Open — reference-target measurements, whole-page HTTP/browser timing, editor, migration and cold boot remain; small/medium/large local runs pass (`deploy/performance-measurements.md` records them).

## C11.12 — Pass real-browser WCAG AA and complete keyboard workflows in

- **F01** — N/A — no database schema; the item ships a string catalog and messaging vocabulary.
- **F02** — `tests/core/sms-keywords.test.ts` — the keyword/consent service boundary refuses protected-word rules.
- **F03** — N/A — no contact, money or audit surface of its own.
- **F04** — `tests/browser/accessibility.spec.ts` — the Arabic catalog renders across the admin, storefront and portal surfaces the suite visits, with direction derived from the shipped catalog (the spec's "catalog-driven Arabic RTL" step).
- **F05** — N/A — verification of existing surfaces; no new agent capability.
- **F06** — `tests/core/i18n-gate.test.ts` — every key in every shipped locale including ar; `tests/core/locale-quality.test.ts`; axe WCAG over visited surfaces in `tests/browser/accessibility.spec.ts`.
- **F07** — `tests/core/sms-keywords.test.ts` — owner rules cannot shadow mandatory carrier words (`assertNotReserved` in `src/core/messaging/keywords.ts`); compliance replies stay non-configurable.
- **F08** — `tests/browser/accessibility.spec.ts` + `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts`.
- **F09** — `pnpm test:a11y` — the browser suite runs against the disposable database; `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts` run in the standard gates.
- **F10** — N/A — a verification item with no setup or demo surface of its own.
- **F11** — `locales/README.md` (AI-drafted-pending-review label) + changeset `arabic-rtl-catalog.md`.
- **F12** — `tests/browser/accessibility.spec.ts` — one browser run drives the Arabic-preferring journey from storefront through portal to the RTL admin.

## C11.13 — Complete failure drills for database/storage/mail/payment/SMS/

- **F01** — N/A — no schema work in this item — it changes planning text, legal notices, CI or developer tooling, not tables.
- **F02** — `tests/core/c11-13-failure-drills.test.ts` — typed-service coverage including permission and refusal assertions.
- **F03** — N/A — the item touches no contact, money or audit surface — nothing to wire into the spine.
- **F04** — N/A — drills are operational recovery, not a new screen; health/doctor/update-admin already surface outages.
- **F05** — N/A — not an agent capability; the same services agents already call are what fail and recover.
- **F06** — N/A — no human surface in this item — nothing to translate or scan.
- **F07** — the drills cover fail-closed adapter errors, idempotent duplicates, preserved ciphertext and automatic update rollback. — `tests/core/c11-13-failure-drills.test.ts`.
- **F08** — `tests/core/c11-13-failure-drills.test.ts` — the item's unit/service/database coverage.
- **F09** — the suite is the operational story. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — N/A — no owner/staff/customer UI in this item — no setup or help surface of its own.
- **F11** — `MASTER.md` §43 annotation this row transcribes + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — the vitest chain. Live provider accounts are not claimed. — `tests/core/c11-13-failure-drills.test.ts`.

## C11.14 — Verify every user-owned record participates correctly in

- **F01** — `tests/core/record-participation.test.ts` — every user-owned table registers its contact FK and privacy hooks; `db/migrations/0011_record_trash.sql` adds the shared `trashed_at` columns for the seven restored families.
- **F02** — `tests/core/c11-14-search.test.ts` — `search.query` is one grant-filtered read over registered scoped services (the audit-repaired scope escalation).
- **F03** — `tests/core/merge-completeness.test.ts` + `tests/core/record-participation.test.ts` — contact FKs are merge-repointed.
- **F04** — `app/(admin)/admin/trash/page.tsx` — a tab per family with view/manage-aware controls (/admin/search, /admin/retention from the earlier partial); `deploy/record-trash.md` is the runbook.
- **F05** — `cms.removePage`/`restorePage`/`purgePage`, `forms.*`, `popups.*`, `segments.*` and `views.*` pairs at /api/v1/*, OpenAPI and the regenerated SDK (`packages/sdk/src/generated.ts`); MCP included.
- **F06** — Host catalog gates `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts`; no per-item scan claimed.
- **F07** — `tests/core/record-trash-families.test.ts` — visibility, search exclusion, slug reservation, submissions-stay-live, hold protection manual and swept, step-up and typed confirmation, fail-closed consumers, personal trash and erasure non-resurrection.
- **F08** — `tests/core/record-trash-families.test.ts` + `tests/core/record-participation.test.ts` + `tests/core/c11-14-search.test.ts` + `tests/core/c11-14-retention.test.ts` + `tests/core/ownership-export.test.ts`.
- **F09** — `tests/core/record-trash-families.test.ts` + `src/core/jobs/core-jobs.ts` — `core.purgeExpiredWorkRecords` purges a bounded batch of every family's expired trash while preserving holds; `deploy/record-trash.md` documents operations and exclusions.
- **F10** — N/A — a verification item with no setup or demo surface of its own.
- **F11** — `deploy/record-trash.md` + `MASTER.md` §43 annotation this row transcribes.
- **F12** — `tests/core/record-trash-families.test.ts` — cross-family composition; `tests/browser/record-trash.spec.ts` drives the popup trash/restore journey in Chromium.

## C11.15 — Remove every scaffold, placeholder, false-positive build

- **F01** — N/A — a cleanup item; it adds no schema.
- **F02** — N/A — it removes and gates rather than adding services.
- **F03** — N/A — no spine touchpoint.
- **F04** — N/A — it removes dead UI actions rather than adding screens.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface.
- **F07** — `tests/core/contract-evidence.test.ts` — a runner exit alone no longer proves a file ran (the audit repair).
- **F08** — `tests/core/contract-evidence.test.ts` + `tests/core/docs-availability.test.ts` + `tests/core/plan-gate.test.ts` — the gates that fail on missing, empty or skipped evidence files.
- **F09** — N/A — CI gate work with no runtime state.
- **F10** — N/A — no owner/staff/customer UI.
- **F11** — `MASTER.md` §43 annotation this row transcribes. — `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `scripts/fast-gates.mjs` — the contract suites compose in the gates run.

## C11.16 — Reconcile §§1–42 against implemented schema/services/UI and

- **F01** — `deploy/spec-reconciliation.md` — §§1–42 mapped against every `pgTable` (343 at reconciliation).
- **F02** — `deploy/spec-reconciliation.md` — the service registry mapping table.
- **F03** — N/A — a mapping item; no spine surface of its own.
- **F04** — N/A — not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface.
- **F07** — `tests/core/spec-reconciliation.test.ts` — refuses to pass while affirmative product work is incomplete (the audit repair).
- **F08** — `tests/core/spec-reconciliation.test.ts`.
- **F09** — N/A — a mapping document, not an operational surface.
- **F10** — N/A — no setup or demo surface.
- **F11** — `deploy/spec-reconciliation.md` + the §43 annotation this row transcribes.
- **F12** — Open — C3.13 and mobile acceptance remain incomplete, so the precondition test keeps the box open (`tests/core/spec-reconciliation.test.ts`).

## C11.17 — Run the full clean-room install, migration, test

- **F01** — N/A — a verification run, not product surface.
- **F02** — N/A — it runs the existing suite rather than adding services.
- **F03** — N/A — no spine touchpoint of its own.
- **F04** — N/A until the owner signs — not a screen.
- **F05** — N/A — not an agent capability.
- **F06** — N/A — no human surface.
- **F07** — N/A until the signed suite — safety claims are exactly what the run must prove.
- **F08** — `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs` run locally; the full command list is in the §43.1 clean-room row.
- **F09** — `deploy/spec-reconciliation.md` — the clean-room command list; `scripts/upgrade-gate.sh` is the upgrade gate.
- **F10** — N/A — no setup or demo surface.
- **F11** — `MASTER.md` §43.1 completion record (prepared 2026-09-13, unsigned). — `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — Open — the clean-room run is not yet executed with zero unexplained failures and the record is unsigned (`scripts/fast-gates.mjs` is the local half).

## C10.17 — v2-deferred (§43.18) — C10.17

- **F01** — N/A — no schema change in this item.
- **F02** — N/A — no new services or customer model; the SDK already enforces grants (`packages/sdk/test/generated.test.mjs`).
- **F03** — N/A — no new spine surface; the companion reuses contact/user linkage and existing lifecycle events.
- **F04** — `tests/core/mobile-screens.test.ts` — loading/empty/error/offline on every companion screen; physical camera, share-target and accessibility proof are v2-deferred (§43.18).
- **F05** — no new services or customer model; the SDK already enforces grants. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — `tests/core/mobile-app-shell.test.ts` — en/es/fr labels and semantic colours; native screen-reader and light/dark inspection is v2-deferred (§43.18).
- **F07** — `tests/core/mobile-screens.test.ts` — staff screens are audience-gated, customer tabs hide, ingest uses the website media pipeline; no mobile-only upload API.
- **F08** — `tests/core/mobile-screens.test.ts` + `tests/core/mobile-app-shell.test.ts` — contract, audience, ingest and shell tests.
- **F09** — N/A — no new jobs or storage — nothing new to model, expose or operate.
- **F10** — N/A — the website already has these owner surfaces (`tests/core/seed-demo.test.ts`).
- **F11** — app/package READMEs and changeset `owner-companion.md`. — `tests/core/mobile-screens.test.ts`.
- **F12** — `tests/core/mobile-app-shell.test.ts` — role detection, staff-only contracts and refused offline ingest are executable; a physical companion journey is v2-deferred (§43.18).

## C10.18 — v2-deferred (§43.18) — C10.18

- **F01** — N/A — no schema change in this item.
- **F02** — N/A — no new services — nothing new to model, expose or operate.
- **F03** — N/A — no new services — nothing new to model, expose or operate.
- **F04** — capture screen: consent, destination, queued/uploading/paused/failed/cancelled, pause/resume/cancel/retry, visible while offline; OS background upload (iOS BGTask / Android WorkManager) was not exercised on a device, so this checkbox stays open. — `tests/core/mobile-capture-batches.test.ts`.
- **F05** — N/A — no new services — nothing new to model, expose or operate.
- **F06** — en/es/fr; native screen-reader and light/dark inspection still required. — `tests/core/mobile-capture-batches.test.ts`.
- **F07** — staff-only; no mobile-only upload API; queue cannot flush as another account. — `tests/core/mobile-capture-batches.test.ts`.
- **F08** — package, shell, screen-contract and pipeline-equivalence tests, including reload-from-cache bytes. — `tests/core/mobile-capture-batches.test.ts`.
- **F09** — N/A — no new jobs — nothing new to model, expose or operate.
- **F10** — `/capture/[token]` already exists. — `tests/core/mobile-capture-batches.test.ts`.
- **F11** — app/package READMEs and changeset `mobile-capture-batches.md`. — `tests/core/mobile-capture-batches.test.ts`.
- **F12** — consent/offline- queue/pause/retry, session binding, persisted bytes and native≡phone Asset records are executable; a physical background-upload journey still needs an installed native build. — `tests/core/mobile-capture-batches.test.ts`.

## C10.25 — v2-deferred (§43.18) — C10.25

- **F01** — no schema change. — `tests/core/bookings.test.ts`.
- **F02** — `bookings.myLinks` has typed input/output, self-service scoping and an explicit ownership check even for privileged callers. — `tests/core/bookings.test.ts`.
- **F03** — existing contact/user linkage, booking lifecycle events and policy/money services are reused. — `tests/core/bookings.test.ts`.
- **F04** — loading, empty, failure, confirmation, pending and moved-link recovery paths are implemented; on-device interaction/accessibility proof remains outstanding, so this checkbox stays open. — `tests/core/bookings.test.ts`.
- **F05** — HTTP/OpenAPI/SDK expose the same query; capability links remain excluded from agent/MCP discovery. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — en/es/fr labels, native timezone-aware picking, locale/currency formatting and semantic colours; device screen-reader and light/dark inspection still required. — `tests/core/bookings.test.ts`.
- **F07** — own-link denial, uncached capabilities, session-isolated read caches, issuing-instance binding, offline refusal, cookie omission, explicit-credential precedence and cookie CSRF protection. — `tests/core/bookings.test.ts`.
- **F08** — service/HTTP/client/shell tests and native bundle checks. — `tests/core/bookings.test.ts`.
- **F09** — no new storage/jobs; existing booking privacy, backup and retention paths apply; CI now bundles both native platforms. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — existing booking records and policy drive the screens; two-factor accounts have an explicit web fallback. — `tests/core/bookings.test.ts`.
- **F11** — mobile READMEs, SDK, API auth description and changeset updated. — `tests/core/bookings.test.ts`.
- **F12** — real HTTP password sign-in → own profile/link → reschedule → new link → cancellation → revoked-session refusal is covered by `tests/core/bookings.test.ts`; device journey still pending.

## C10.26 — v2-deferred (§43.18) — C10.26

- **F01** — no schema changes. — `tests/core/customer-invoices.test.ts`.
- **F02** — authenticated `invoicing.customerInvoiceLink` reuses C5.25 ownership checks and returns only a payable invoice's browser capability; another contact, anonymous caller or unlinked owner is refused. — `tests/core/customer-invoices.test.ts`.
- **F03** — existing invoice, contact, payment and provider flow remain the source of truth. — `tests/core/customer-invoices.test.ts`.
- **F04** — list/detail loading, empty, failed room, stale read, unavailable payment, offline and browser-open failure states are implemented; physical-device interaction/accessibility proof remains, so this checkbox stays open. — `tests/core/customer-invoices.test.ts`.
- **F05** — HTTP/OpenAPI/SDK expose the query; capability retrieval is excluded from agent/MCP discovery. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — en/es/fr labels, currency exponents, business timezone, semantic colours and web return links; native screen-reader and light/dark inspection remain pending. — `tests/core/customer-invoices.test.ts`.
- **F07** — no app payment mutation, no session token in a URL, uncached invoice capabilities, same-origin browser handoff, and instance-bound app return links. Paid invoices produce no link. — `tests/core/customer-invoices.test.ts`.
- **F08** — customer invoice authorization/retirement tests, mobile contract/shell checks, currency rendering and browser return-link assertions. — `tests/core/customer-invoices.test.ts`.
- **F09** — no new jobs or storage; existing invoice privacy/backup/retention apply. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — manual providers show instructions rather than claiming payment; browser return and app foreground refresh always reread the ledger. — `tests/core/customer-invoices.test.ts`.
- **F11** — SDK, READMEs and changeset updated. — `tests/core/customer-invoices.test.ts`.
- **F12** — own session → invoice capability → anonymous browser invoice is service-tested; C5.25's browser journey checks return links in all three locales/both themes and on the receipt. Physical browser-to-app return still needs an installed native build. — `tests/core/customer-invoices.test.ts`.

## C10.27 — v2-deferred (§43.18) — C10.27

- **F01** — no schema or new services; the app is a client of the existing gallery and portal APIs. The contract still excludes owner-only `galleries.list` and `galleries.listSelections`. — `tests/core/client-galleries.test.ts`.
- **F02** — no schema or new services; the app is a client of the existing gallery and portal APIs. The contract still excludes owner-only `galleries.list` and `galleries.listSelections`. — `tests/core/client-galleries.test.ts`.
- **F03** — no schema or new services; the app is a client of the existing gallery and portal APIs. The contract still excludes owner-only `galleries.list` and `galleries.listSelections`. — `tests/core/client-galleries.test.ts`.
- **F04** — list and proofing screens have loading, empty, failed, offline and stale paths; expiry clears displayed photos while the screen stays open. Physical-device interaction and accessibility proof remains outstanding, so this checkbox stays open. — `tests/core/client-galleries.test.ts`.
- **F05** — no schema or new services; the app is a client of the existing gallery and portal APIs. The contract still excludes owner-only `galleries.list` and `galleries.listSelections`. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — en/es/fr proofing labels and semantic colours; native screen-reader and light/dark inspection still required. — `tests/core/client-galleries.test.ts`.
- **F07** — 401/403/404 evict image bytes immediately; offline failures never renew the lease; sign-out cannot let a late image write refill the next account; proofing writes go through `writeThrough` and are never queued. — `tests/core/client-galleries.test.ts`.
- **F08** — focused mobile contract/shell/cache tests, Expo and package typechecks. — `tests/core/client-galleries.test.ts`.
- **F09** — no new jobs or storage; C10.30's vault holds the ciphertext. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — the website already has the room and proofing page. — `tests/core/client-galleries.test.ts`.
- **F11** — app/package READMEs and changeset `native-gallery-proofing.md`. — `tests/core/client-galleries.test.ts`.
- **F12** — lease expiry, denial eviction and refused offline writes are executable tests; a physical proofing journey still needs an installed native build. `TAB_ORDER` now includes invoices so that C10.26 tab is actually shown. — `tests/core/client-galleries.test.ts`.

## C10.28 — v2-deferred (§43.18) — C10.28

- **F01** — N/A — no schema change in this item.
- **F02** — customer reply is `authenticated` and ownership-checked; get is the existing query with a second audience. — `tests/core/mobile-app-shell.test.ts`.
- **F03** — contact/user linkage and `conversations.record` are reused. — `tests/core/mobile-app-shell.test.ts`.
- **F04** — loading/empty/failed/offline paths on the new screens; device interaction and accessibility proof remain outstanding, so this checkbox stays open. — `tests/core/mobile-app-shell.test.ts`.
- **F05** — HTTP/OpenAPI/SDK expose the mutation. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — en/es/fr labels and semantic colours; native screen-reader and light/dark inspection still required. — `tests/core/mobile-app-shell.test.ts`.
- **F07** — own-thread-only reply, no business `conversations.reply`, no email-footer unsubscribe, sign-out revokes a held device token, writes are live-only. — `tests/core/mobile-app-shell.test.ts`.
- **F08** — service/HTTP/client/shell tests. — `tests/core/mobile-app-shell.test.ts`.
- **F09** — N/A — no new storage or jobs — nothing new to model, expose or operate.
- **F10** — the website now has the same thread view. — `tests/core/mobile-app-shell.test.ts`.
- **F11** — app/package READMEs and changeset `customer-reply-and-account.md`. — `tests/core/mobile-app-shell.test.ts`.
- **F12** — HTTP customer reply and native 2FA client path are executable tests; a physical journey still needs an installed native build. — `tests/core/mobile-app-shell.test.ts`.

## C10.30 — v2-deferred (§43.18) — C10.30

- **F01** — no schema, service or permission changes; existing reads remain authoritative across web, HTTP and agent clients. — `tests/core/mobile-private-cache.test.ts`.
- **F02** — no schema, service or permission changes; existing reads remain authoritative across web, HTTP and agent clients. — `tests/core/mobile-private-cache.test.ts`.
- **F03** — no schema, service or permission changes; existing reads remain authoritative across web, HTTP and agent clients. — `tests/core/mobile-private-cache.test.ts`.
- **F04** — the existing native loading/stale/error states remain; private data is hidden while backgrounded and before an account/route transition can render an old result. Expiry clears it and triggers a fresh query. Uncached management links also follow session invalidation; the bookings profile uses the private lease so it does not block an offline cached list. Physical light/dark, screen-reader and foreground/cold-start checks remain pending. — `tests/core/mobile-private-cache.test.ts`.
- **F05** — no schema, service or permission changes; existing reads remain authoritative across web, HTTP and agent clients. — surface equivalence: `tests/core/api.test.ts` (every service has an endpoint, spec schema is the validator), `tests/core/sdk-schema.test.ts` (generated client contract) and `tests/core/mcp.test.ts` (registry-derived MCP tools)..
- **F06** — the existing native loading/stale/error states remain; private data is hidden while backgrounded and before an account/route transition can render an old result. Expiry clears it and triggers a fresh query. Uncached management links also follow session invalidation; the bookings profile uses the private lease so it does not block an offline cached list. Physical light/dark, screen-reader and foreground/cold-start checks remain pending. — `tests/core/mobile-private-cache.test.ts`.
- **F07** — 401 invalidates the active session's entire cache; 403/404 evict the denied read. A late 401 from an old account cannot clear the new account. Failed requests never renew the private lease; cache failures never switch to plaintext. — `tests/core/mobile-private-cache.test.ts`.
- **F08** — `tests/core/mobile-private-cache.test.ts` covers exact expiry, encryption/tampering, denial bodies, delayed reads/writes, superseded keychain opens, cleanup failure and offline restart.
- **F09** — cache files are disposable, with no jobs or queued writes; public discovery may restore branding offline, but grants no extension to private read leases. — enforced in CI by `scripts/plan-gate.mjs` and `scripts/fast-gates.mjs`.
- **F10** — the existing native loading/stale/error states remain; private data is hidden while backgrounded and before an account/route transition can render an old result. Expiry clears it and triggers a fresh query. Uncached management links also follow session invalidation; the bookings profile uses the private lease so it does not block an offline cached list. Physical light/dark, screen-reader and foreground/cold-start checks remain pending. — `tests/core/mobile-private-cache.test.ts`.
- **F11** — app/package READMEs and the changeset describe the policy. Local validation passed 219 required contract tests (25 files), 67 focused app/cache tests, native/root typechecks, the shared package build, lint after correcting a test-helper binding, and Android/iOS Hermes exports. PR #333 carries the implementation; the item remains open for the native-device evidence above. — `tests/core/mobile-private-cache.test.ts`.
- **F12** — `tests/core/mobile-private-cache.test.ts` covers exact expiry, encryption/tampering, denial bodies, delayed reads/writes, superseded keychain opens, cleanup failure and offline restart.

## packages/cli — @freeholder/cli — freeholder update (check/preflight/apply/rollback)

- **F01** — N/A — the updater ships no schema; it applies the instance's own migration chain.
- **F02** — `tests/core/update-cli.test.ts` — preflight/apply/rollback verbs with refusal on failed preconditions.
- **F03** — N/A — no spine touchpoint; it orchestrates the host's migrate/smoke/cutover steps.
- **F04** — N/A — a terminal tool, not an admin screen.
- **F05** — N/A — a local operator CLI, not exposed over HTTP/MCP.
- **F06** — N/A — terminal output only.
- **F07** — `tests/core/update-cli.test.ts` + `tests/core/c11-13-failure-drills.test.ts` — interrupted-update rollback and failAt recovery drills.
- **F08** — `tests/core/update-cli.test.ts` — the CLI suite.
- **F09** — N/A — the package is itself operator tooling; its rollback evidence is its own suite.
- **F10** — `packages/cli/README.md` — operator usage documented.
- **F11** — `packages/cli/README.md` + `deploy/update-policy.md` — the update policy the CLI enforces.
- **F12** — `tests/core/c11-08-install-update-journey.test.ts` — install/update/rollback composes with the whole product.

## packages/create-freeholder — create-freeholder — npx installer/scaffolder

- **F01** — N/A — the installer creates a source project, not schema in this repository.
- **F02** — `tests/core/create-freeholder.test.ts` — scaffold/check/install/print-setup-URL verbs with environment validation and refusal.
- **F03** — N/A — no spine touchpoint; it prepares an empty instance.
- **F04** — N/A — a terminal tool, not an admin screen.
- **F05** — N/A — runs before any service exists; nothing to expose.
- **F06** — N/A — terminal output only.
- **F07** — `tests/core/create-freeholder.test.ts` — environment checks refuse unsafe installs instead of guessing.
- **F08** — `tests/core/create-freeholder.test.ts` — the installer suite.
- **F09** — N/A — a local scaffolding tool with no durable state of its own.
- **F10** — `packages/create-freeholder/README.md` — the npx workflow documented.
- **F11** — `packages/create-freeholder/README.md` + changeset `create-freeholder-setup.md`.
- **F12** — `tests/core/create-freeholder.test.ts` — scaffold-to-setup-URL end to end.

## packages/freeholder-app — freeholder-app — npx init: instance branding to store-ready app config

- **F01** — N/A — writes Expo config and assets, not database schema.
- **F02** — `tests/core/freeholder-app-init.test.ts` — the init boundary: pull branding, write icons/splash/metadata and an auditable config diff.
- **F03** — N/A — no spine touchpoint.
- **F04** — N/A — a terminal tool, not a screen.
- **F05** — N/A — local CLI, not an agent surface.
- **F06** — `packages/freeholder-app/src/branding.ts` + `tests/core/freeholder-app-init.test.ts` — locale-aware branding/metadata.
- **F07** — `tests/core/freeholder-app-init.test.ts` — refuses partial/invalid instance configuration rather than emitting a broken app.
- **F08** — `tests/core/freeholder-app-init.test.ts` — the init suite.
- **F09** — `scripts/package-artifact-gate.mjs` — packed, installed and exercised by `pnpm packages:verify`.
- **F10** — `packages/freeholder-app/README.md` — the npx init workflow.
- **F11** — `packages/freeholder-app/README.md` + changeset `freeholder-app-init.md`.
- **F12** — `tests/core/freeholder-app-init.test.ts` — pull → diff → store-ready output end to end.

## packages/mobile-app — @freeholder/mobile-app — white-label Expo/React Native customer app (v2-deferred device proof)

- **F01** — N/A — the app owns no schema; it is a client of the website APIs (§43.18).
- **F02** — N/A — no services of its own; writes go through the generated SDK under host permissions (§43.18).
- **F03** — N/A — no spine touchpoint of its own.
- **F04** — `tests/core/mobile-screens.test.ts` + `tests/core/mobile-app-shell.test.ts` — screen contracts for every tab; physical camera/screen-reader proof is v2-deferred (§43.18).
- **F05** — `packages/mobile-app/README.md` — the app calls only the generated SDK; the §43.18 quotes record that HTTP/OpenAPI/SDK expose every query it uses.
- **F06** — en/es/fr labels and semantic colours in `tests/core/mobile-app-shell.test.ts`; native screen-reader and light/dark inspection is v2-deferred (§43.18).
- **F07** — `tests/core/mobile-private-cache.test.ts` — session-bound encrypted cache, immediate denial eviction, no cross-account flush.
- **F08** — `tests/core/mobile-screens.test.ts`, `tests/core/mobile-app-shell.test.ts`, `tests/core/mobile-private-cache.test.ts`, `tests/core/mobile-capture-batches.test.ts`.
- **F09** — N/A — disposable on-device cache, no new jobs or storage (§43.18).
- **F10** — `packages/mobile-app/README.md` — the app is driven entirely by the generated SDK.
- **F11** — `packages/mobile-app/README.md` + changeset `mobile-app-package.md` + the §43.18 quotes.
- **F12** — `tests/core/mobile-capture-batches.test.ts` — native batch and app-free phone path create equivalent Assets; device journeys are v2-deferred (§43.18).

## packages/plugin-kit — @freeholder/plugin-kit — definePlugin authoring contract (MASTER.md §24, C3.08)

- **F01** — N/A — no schema of its own; plugins declare tables through per-plugin schema files (e.g. `plugins/community/schema.ts`) and the host's migration seam.
- **F02** — `packages/plugin-kit/src/contract.ts` + `tests/core/plugin-scaffold.test.ts` — the definePlugin contract a scaffolded plugin compiles against.
- **F03** — N/A — an authoring library; spine wiring is the host's job at load time.
- **F04** — N/A — an authoring library, not a screen.
- **F05** — `tests/core/plugin-contract.test.ts` — the contract that keeps host registry surfacing (HTTP/MCP) derived.
- **F06** — N/A — no human surface.
- **F07** — `tests/core/plugin-contract.test.ts` — permissions, compatibility and semver boundaries a plugin must declare.
- **F08** — `tests/core/plugin-scaffold.test.ts` + `tests/core/plugin-contract.test.ts` + `tests/fixtures/sample-plugin` round trip.
- **F09** — N/A — a dev library with no runtime state.
- **F10** — `packages/plugin-kit/README.md` + `packages/plugin-kit/src/scaffold.ts` — authors start from a working skeleton.
- **F11** — `packages/plugin-kit/README.md` + changeset `plugin-contract.md`.
- **F12** — `tests/core/plugin-scaffold.test.ts` — scaffold → load in the host harness end to end.

## packages/sdk — @freeholder/sdk — typed client generated from the live service registry

- **F01** — N/A — the client owns no schema; it is generated from the live registry (`scripts/generate-sdk.mjs`).
- **F02** — `scripts/generate-sdk.mjs` + `packages/sdk/src/generated.ts` — the typed client is generated from registry JSON Schema; `tests/core/sdk-generation.test.ts` fails if generation skips or goes stale.
- **F03** — N/A — a client only repoints HTTP calls; spine wiring lives server-side.
- **F04** — N/A — a library, not a screen.
- **F05** — `packages/sdk/test/generated.test.mjs` + `tests/core/sdk-schema.test.ts` — the SDK is itself the agent-surface artifact; every exported call shape is exercised.
- **F06** — N/A — no human surface.
- **F07** — `tests/core/sdk-generation.test.ts` — a stale or partially generated client fails the suite rather than shipping silently.
- **F08** — `tests/core/sdk-generation.test.ts` + `tests/core/sdk.test.ts` + `packages/sdk/test/generated.test.mjs`.
- **F09** — `scripts/package-artifact-gate.mjs` — the package is packed, installed and exercised by `pnpm packages:verify`.
- **F10** — `packages/sdk/README.md` — usage without repository knowledge.
- **F11** — `packages/sdk/README.md` + changeset `package-artifact-integrity.md`.
- **F12** — `tests/core/sdk-generation.test.ts` — live-registry generation round trip.

## packages/templates — @freeholder/templates — Bench-token business presets with full page/entity/email trees

- **F01** — N/A — presets are content, not tables; they bind to the CMS at install.
- **F02** — `tests/core/templates.test.ts` — preset trees validate against the typed CMS contract.
- **F03** — N/A — content presets carry no contact/money records of their own.
- **F04** — N/A — content, not a screen; the surfaces are the CMS (C2 rows).
- **F05** — N/A — no agent surface of its own.
- **F06** — `tests/core/templates.test.ts` — preset locale trees ship complete catalogs.
- **F07** — N/A — inert content trees; nothing executable to threaten.
- **F08** — `tests/core/templates.test.ts` + `tests/core/cms-templates.test.ts`.
- **F09** — N/A — disposable install-time content.
- **F10** — The package IS seed/demo content: `tests/core/templates.test.ts` proves a full business tree installs.
- **F11** — `packages/templates/README.md` + changeset `business-presets.md`.
- **F12** — `tests/core/cms-templates.test.ts` — presets bind to the host CMS end to end.

## plugins/community — community plugin — gated member spaces (audit-repaired identity boundary)

- **F01** — `plugins/community/schema.ts` + `db/migrations/0001_community_rooms.sql` — rooms/membership tables through the host baseline seam.
- **F02** — `tests/core/community-rooms.test.ts` — the typed service boundary: session-linked identity for reads, posts, moderation and reports.
- **F03** — `tests/core/community-rooms.test.ts` — membership repoints with contact merge on the spine.
- **F04** — Host-rendered public community pages; the gated journey is `tests/browser/first-party-plugins.spec.ts` ("gated communities use the signed-in member, never a supplied email").
- **F05** — Plugin services surface through the same registry derivation as core — `tests/core/api.test.ts` equivalence; service names in `plugins/community/service.ts`.
- **F06** — Host catalog gates `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts`; no per-item scan claimed.
- **F07** — `tests/core/community-rooms.test.ts` — the 2026-09-13 audit repair: forged email, signed-in outsider, anonymous moderator and member-impersonating-moderator refusals.
- **F08** — `tests/core/community-rooms.test.ts` — seven focused room/moderation tests.
- **F09** — N/A as C11.14 — plugin rows ride the host's retention/erasure seams; participation proof is product-wide (`tests/core/record-participation.test.ts`).
- **F10** — Partial, honestly labelled: rides the host demo (`tests/core/seed-demo.test.ts`); no plugin-specific seed claimed.
- **F11** — `plugins/community/manifest.ts` + `plugins/community/plugin.json` + `deploy/spec-reconciliation.md` (§-mapping).
- **F12** — `tests/browser/first-party-plugins.spec.ts` — anonymous caller, outsider and signed-in member post through the real form.

## plugins/gift-registry — gift-registry plugin — registry and gifting on the catalog spine

- **F01** — `plugins/gift-registry/schema.ts` + `db/migrations/0000_reviewed-baseline.sql` (plugin tables folded by the reviewed baseline, C10.19).
- **F02** — `tests/core/product-gift-share.test.ts` — registry services on the typed catalog boundary.
- **F03** — `tests/core/product-gift-share.test.ts` — gifts stay on the contact/invoice spine, no parallel money path.
- **F04** — Host storefront/registry pages; sharing surfaces proven by `tests/core/product-gift-share.test.ts`.
- **F05** — Registry surfacing via the host registry — `tests/core/api.test.ts` equivalence.
- **F06** — Host catalog gates `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts`; no per-item scan claimed.
- **F07** — `tests/core/product-gift-share.test.ts` — permission and refusal on registry reads/writes.
- **F08** — `tests/core/product-gift-share.test.ts` — the registry/gift suite.
- **F09** — N/A as C11.14 — rides the host's retention/erasure seams (`tests/core/record-participation.test.ts`).
- **F10** — Partial, honestly labelled: rides the host demo (`tests/core/seed-demo.test.ts`); no plugin-specific seed claimed.
- **F11** — `plugins/gift-registry/manifest.ts` + `plugins/gift-registry/plugin.json` + `deploy/spec-reconciliation.md`.
- **F12** — `tests/browser/first-party-plugins.spec.ts` — registry visible to visitors after owner setup.

## plugins/marketplace — marketplace plugin — channel sync with leased workers (audit-repaired claims)

- **F01** — `plugins/marketplace/schema.ts` + `db/migrations/0004_marketplace_channel_sync.sql` + `db/migrations/0007_marketplace_sync_lease.sql`.
- **F02** — `tests/core/marketplace-claims.test.ts` — the sync/claim boundary: expired workers cannot import or checkpoint another sync's work.
- **F03** — `tests/core/marketplace-claims.test.ts` — imported contacts/invoices/channel-orders atomically join the spine.
- **F04** — Host admin channel pages; `tests/browser/first-party-plugins.spec.ts` ("marketplace setup explains draft imports and refuses unconfigured access").
- **F05** — Channel services via the host registry — `tests/core/api.test.ts` equivalence; `plugins/marketplace/adapter.ts` + `plugins/marketplace/shopify.ts`.
- **F06** — Host catalog gates `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts`; no per-item scan claimed.
- **F07** — `tests/core/marketplace-claims.test.ts` + `tests/core/plugin-provider-boundary.test.ts` — exclusive claims, stale-checkpoint refusal, and no fabricated vendor state outside `NODE_ENV=test`.
- **F08** — `tests/core/marketplace-claims.test.ts` + `tests/core/plugin-provider-boundary.test.ts`.
- **F09** — N/A as C11.14 — rides the host's retention/erasure seams (`tests/core/record-participation.test.ts`).
- **F10** — Partial, honestly labelled: rides the host demo (`tests/core/seed-demo.test.ts`); no plugin-specific seed claimed.
- **F11** — `plugins/marketplace/manifest.ts` + `plugins/marketplace/plugin.json` + `deploy/spec-reconciliation.md`.
- **F12** — `tests/browser/first-party-plugins.spec.ts` — setup → draft import → refused unconfigured access.

## plugins/print-on-demand — print-on-demand plugin — Printify fulfillment (live adapter shipped after audit)

- **F01** — `plugins/print-on-demand/schema.ts` + `db/migrations/0003_print_on_demand_fulfillment.sql` + `db/migrations/0008_printify_live_fulfillment.sql`.
- **F02** — `tests/core/printify-fulfillment.test.ts` — paid catalog lines fulfilled through Printify with retry state preserved.
- **F03** — `tests/core/printify-fulfillment.test.ts` — fulfillment records bind to the order/invoice spine.
- **F04** — Host admin product-connection pages; `tests/browser/first-party-plugins.spec.ts` ("owner configures a Printify product and variant").
- **F05** — Fulfillment services via the host registry — `tests/core/api.test.ts` equivalence; `plugins/print-on-demand/printify.ts`.
- **F06** — Host catalog gates `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts`; no per-item scan claimed.
- **F07** — `tests/core/plugin-provider-boundary.test.ts` + `tests/core/printify-adapter.test.ts` — the audit repair: fixture adapters refuse outside `NODE_ENV=test`; live fulfillment errors stay retryable.
- **F08** — `tests/core/printify-adapter.test.ts` + `tests/core/printify-fulfillment.test.ts`.
- **F09** — N/A as C11.14 — rides the host's retention/erasure seams (`tests/core/record-participation.test.ts`).
- **F10** — Partial, honestly labelled: rides the host demo (`tests/core/seed-demo.test.ts`); no plugin-specific seed claimed.
- **F11** — `plugins/print-on-demand/manifest.ts` + `plugins/print-on-demand/plugin.json` + `deploy/spec-reconciliation.md`.
- **F12** — `tests/browser/first-party-plugins.spec.ts` — configure product and variant end to end.

## plugins/social-fixture — social-fixture plugin — honest test fixture provider for the social seam

- **F01** — N/A — the fixture holds no durable tables of its own.
- **F02** — `plugins/social-fixture/adapter.ts` — the fixture answers the same typed social contract as live providers.
- **F03** — N/A — no spine touchpoint; fixtures never write records.
- **F04** — N/A — a fixture provider, no human surface.
- **F05** — N/A — not exposed; it stands behind the social seam in tests only.
- **F06** — N/A — no UI.
- **F07** — `tests/core/plugin-provider-boundary.test.ts` — the boundary that keeps fixtures from fabricating state in any non-test environment.
- **F08** — `tests/core/social-http.test.ts` — the social seam exercised against the fixture.
- **F09** — N/A — no durable data, no jobs.
- **F10** — N/A — test tooling.
- **F11** — `plugins/social-fixture/manifest.ts` + `plugins/social-fixture/plugin.json` + `deploy/spec-reconciliation.md`.
- **F12** — `tests/core/social-http.test.ts` — fixture-backed social flows compose with the host.

## plugins/voice-video — voice-video plugin — private Daily rooms and verified recording access

- **F01** — `plugins/voice-video/schema.ts` + `db/migrations/0002_voice_video_rooms.sql` + `db/migrations/0009_daily_voice_video.sql`.
- **F02** — `tests/core/daily-adapter.test.ts` + `tests/core/daily-flow.test.ts` — the room/recording boundary on the typed contract.
- **F03** — `tests/core/daily-flow.test.ts` — room access and recording state stay contact-bound.
- **F04** — Host portal/admin room pages; `tests/core/portal-rooms.test.ts` proves rooms read through the same services as admin; `tests/browser/first-party-plugins.spec.ts` ("Daily setup refuses unconfigured rooms without reporting a live call").
- **F05** — Room services via the host registry — `tests/core/api.test.ts` equivalence; `plugins/voice-video/adapter.ts`.
- **F06** — Host catalog gates `tests/core/i18n-gate.test.ts` + `tests/core/locale-quality.test.ts`; no per-item scan claimed.
- **F07** — `tests/core/plugin-provider-boundary.test.ts` + `tests/core/daily-flow.test.ts` — verified recording access and no fabricated call state outside test.
- **F08** — `tests/core/daily-adapter.test.ts` + `tests/core/daily-flow.test.ts` + `tests/core/deferred-erasure.test.ts`.
- **F09** — N/A as C11.14 — rides the host's retention/erasure seams (`tests/core/record-participation.test.ts`).
- **F10** — Partial, honestly labelled: rides the host demo (`tests/core/seed-demo.test.ts`); no plugin-specific seed claimed.
- **F11** — `plugins/voice-video/manifest.ts` + `plugins/voice-video/plugin.json` + `deploy/spec-reconciliation.md`.
- **F12** — `tests/browser/first-party-plugins.spec.ts` — unconfigured rooms refuse honestly in the real browser.

