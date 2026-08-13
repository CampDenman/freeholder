# Freeholder handoff — C1.25

Last updated: 2026-08-13 (America/Vancouver)

## Resume point

Resume `MASTER.md` §43 at **C1.25**:

> Build resumable, role/capability-derived onboarding for owner,
> administrator, editor, bookkeeper, service provider and customer, with
> first-win tasks, contextual relaunch, skip/reset, progress and forbidden-
> control accessibility/permission tests.

The working branch is `feat/role-onboarding`, created directly from current
`main` at merge commit `dd34df798435c65d5f39e8dd60177fb655f65a5c`.
C1.25 foundation work is committed at `0b3ccdb` (`feat: establish role guidance
foundation`). It is intentionally incomplete: the schema, definitions and
service exist, while human surfaces and acceptance coverage are the next
checkpoint.

Do not commit or modify the separate untracked `RESTART_HANDOFF.md`; it is an
older local document outside this checkpoint.

## Verified baseline

- Apache-2.0 relicensing is merged in PR #89.
- C1.23 ownership recovery is merged in PR #94 at `030a4ab`.
- C1.24 fresh seeded home is merged in PR #95 at `dd34df7`.
- `main` and `origin/main` were synchronized before this branch was created.
- `MASTER.md` marks C1.24 complete and names C1.25 as the current focus.

C1.24 now provides this contract:

- a truly pristine development database installs Aurora Coast automatically;
- production remains opt-in with `FREEHOLDER_SEED_DEMO=1`;
- `FREEHOLDER_SEED_DEMO=0` deliberately preserves a blank development setup;
- implicit development seeding refuses a database with an owner or business
  profile already in progress;
- a copied `.env.example` treats blank optional placeholders as unset;
- a seeded demo remains claimable through the normal `/setup` owner form;
- unexpected seed failures stop startup instead of silently serving the setup
  placeholder;
- the clean-image gate verifies `/` contains the business identity, authored
  H1, header, footer and generated media before any owner or repair write.

## Evidence

Local C1.24 verification:

- `pnpm test`: 88 files, 1,085 tests passed in 738.54 seconds;
- `pnpm build`: passed (the known optional `@replit/object-storage` warning
  remains);
- `pnpm lint`, `pnpm typecheck`, `pnpm plan:check`, `pnpm license:check`,
  `pnpm dependency:audit`: passed;
- `bash -n scripts/public-gates.sh`: passed;
- schema compatibility, changeset and diff checks: passed.

GitHub evidence:

- PR #95 CI: run `31718491259`, passed in 9m27s, including the 1,085 tests,
  ownership restore drill, build, real-browser gates, image smoke, seeded-home
  gate, SEO, schema, upgrade and changeset gates;
- post-merge CI: run `31719359788`, success on `dd34df7`;
- post-merge image publication: run `31719359728`, success on `dd34df7`,
  including push, keyless signature, provenance, SBOM and SBOM attestation.

The ownership-export integration test now has an explicit 30-second timeout.
Its every-table export and media inventory take roughly 5–9 seconds locally;
the former five-second default caused a timeout after the operation completed,
not an assertion or export-integrity failure.

## C1.25 implementation checkpoint

Repository discovery is complete. The remaining contract files, migration
conventions, customer magic-link linkage, admin navigation and portal privacy
surface were inspected before implementation.

Commit `0b3ccdb` contains this foundation:

- `src/core/guidance/schema.ts` defines versioned `guidance_flows` and
  per-user `guidance_progress`. Progress stores completed and seen steps,
  active/dismissed/completed state, start/completion/dismissal timestamps and
  database invariants. `seen_steps` is deliberate: when a newly granted
  capability exposes another step, a completed or skipped flow reactivates.
- `db/migrations/0040_curved_purple_man.sql`, its snapshot and journal entry
  create the tables and install all six core version-1 definitions. The SQL
  seed was appended after Drizzle generation and must stay byte-for-behavior
  consistent with the TypeScript definitions.
- `src/core/guidance/definitions.ts` validates capabilities, steps, internal
  targets and outcome predicates with Zod. It defines owner, administrator,
  editor, bookkeeper, service-provider and customer first-win flows.
- Roles rank the most relevant lesson; they do not authorize it. Any flow with
  capability prerequisites is available to a custom role holding the same
  effective grants. Every individual step is filtered again by its own grants.
  The grant-free customer flow remains audience-scoped.
- The shipped outcomes are real product facts: service audit actions, a form
  submission after the flow began, or a linked customer portal account. There
  is no mark-complete/next-click API.
- `src/core/guidance/service.ts` implements list/reconcile, start/resume,
  dismiss (the "skip for now" behavior), and reset. Reconciliation records
  completed steps from durable evidence and reactivates a flow when a newly
  visible capability step appears.
- Guidance tables/services are registered in core. First-owner recovery and
  both database reset helpers seed immutable core definitions.
- English, French and Spanish catalog entries for the six flows, their tasks,
  progress and controls are present and parse as valid JSON.

The capability audit also found a pre-existing dashboard bug to fix in this
checkpoint: `app/(admin)/admin/page.tsx` requires only `admin:view` but always
calls contact and event queries. The default editor lacks those grants, so the
overview must conditionally query and render those widgets.

## Verification at shutdown

- `pnpm typecheck` passed after the schema, definitions, service and core
  registration were added.
- All three modified locale catalogs pass PowerShell JSON parsing.
- `git diff --check` passed before the foundation commit.
- No focused guidance tests, migration execution, lint, production build or
  full suite has run yet. Do not treat the foundation as C1.25 acceptance.

One design detail deserves an explicit review during tests: `guidance.list` is
declared as a query but reconciles derived `GuidanceProgress` evidence inside
its transaction. It never creates a fake completion/audit event; nevertheless,
prove retry/idempotence and decide whether this derived-state write remains the
right service semantic before the PR.

## Resume sequence

1. Add focused definition/service/migration tests first. Prove all six default
   roles receive a useful preferred flow, custom roles are capability-derived,
   forbidden steps are absent, outcomes require post-start product evidence,
   skip/resume/reset are isolated per user/version, and a newly granted step
   reactivates progress. Include migration-vs-TypeScript seed parity.
2. Build a semantic shared guidance panel (`<progress>`, ordered task list,
   explicit status text and server-action controls), admin guidance actions and
   an `/admin/guidance` surface. Embed the preferred guide on the admin
   overview.
3. Add capability-filtered contextual help in the admin shell. Integrate the
   customer guide and a contextual relaunch anchor into the authenticated
   portal privacy surface. Add stable IDs for the preferences and notification
   schedule targets already named by the definitions.
4. Fix the admin overview's unconditional contact/event reads while wiring its
   guidance panel. Forbidden cards and guide links must be absent rather than
   disabled.
5. Add static accessibility/permission coverage and a real-browser journey for
   owner/staff/customer start, real-outcome completion, resume, skip, reset and
   contextual relaunch. Run axe and keyboard checks.
6. Add the changeset/operator-facing documentation, run migrations and the
   complete local gates, update `MASTER.md` only with acceptance evidence, then
   use the signed PR/CI/merge/post-merge flow.

C1.26 still owns deterministic demo scenarios and general module/plugin
manifest contributions/conformance. Do not pull that separate checklist item
into C1.25, but preserve the current versioned registry seam for it.

## Constraints to preserve

- `MASTER.md` §43 remains the sole product/delivery checklist.
- Do not mark the overall completion goal complete until every §43 item through
  C11.17 is verified.
- No public launch or marketing work is required.
- Do not add paid services or expose secrets.
- Preserve unrelated local state, especially untracked `RESTART_HANDOFF.md`.
- Use signed commits and protected-branch PR/CI/merge flow.
- A new object-storage credential value appeared in local failed-test output
  during C1.24 validation. It was never committed or sent to GitHub, and its
  value is intentionally absent here. Rotate that local credential before it
  is used again.
