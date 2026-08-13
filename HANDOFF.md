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
No C1.25 product implementation has started. This handoff is the branch's only
intended change.

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

## C1.25 audit status

Repository discovery is substantially complete; no C1.25 product code has been
written. Resume at the schema/registry design rather than repeating the broad
search.

The important findings are:

- `MASTER.md` already specifies the durable entities. `GuidanceFlow` is a
  versioned, role/capability-scoped definition with `key`, `version`,
  `audience_roles[]`, `required_capabilities[]`, `steps` and `status`.
  `GuidanceProgress` stores per-user `flow_key`, `flow_version`, completed
  steps, state, start time and completion time.
- The required behavior is task-based and permission-derived: flows resume,
  dismiss/skip, reset, relaunch from contextual help and reappear when a user
  gains a useful role/capability. Completion must reflect a real service
  outcome, not a tooltip click.
- Core role defaults live in `src/core/roles/defaults.ts`. They seed owner,
  administrator, editor, bookkeeper, service-provider, customer and legacy
  staff grants. Role names are explicitly not permission branches.
- `src/core/roles/service.ts`, `src/core/service.ts` and
  `src/core/http/actor.ts` make stored module grants the effective permission
  source. A query maps to `view`; a mutation maps to `manage`. Role assignment
  refreshes grants on existing sessions. Custom roles therefore need to
  receive applicable flows based on their grants too.
- Owner-only operations intentionally remain nondelegable through
  `requireOwnerActor`; this is distinct from normal module access.
- The admin shell already filters navigation by capabilities. Its overview
  currently requires the `admin` grant but unconditionally reads contact stats
  and recent activity. That likely breaks the default editor, which has admin
  access but no contact/event grants. C1.25 should make overview widgets and
  onboarding outcomes capability-safe instead of leaking or merely disabling
  forbidden controls.
- Auth schema has roles, grants, users, sessions, 2FA, password resets and
  staff invitations, but no guidance tables. Customer users can have a null
  password and role `customer`.
- Invitation acceptance and session grant refresh already exist and are the
  natural point at which newly granted onboarding becomes discoverable.
- The customer portal currently has login, magic-link and privacy surfaces but
  no shared portal home/layout equivalent to the admin dashboard. Customer
  onboarding therefore needs a small authenticated entry surface or a careful
  integration with the existing privacy page.
- No generic task/checklist model was found. Notifications exist, but guidance
  progress should remain a separate user-facing onboarding concern rather than
  overloading operational notifications.
- Existing browser journey and accessibility suites provide the right fixtures
  for permission-derived visibility, forbidden-control absence, progress,
  skip/reset, resume and contextual-relaunch coverage.
- C1.26 explicitly owns deterministic demo scenarios plus module/plugin
  manifest contribution and conformance tests. C1.25 should establish a core
  registry that can be extended next, without pulling all C1.26 scope forward.

## Recommended implementation sequence

1. Read the remaining short contract files individually:
   `src/core/module.ts`, `src/core/manifest.ts`, `src/modules/index.ts` and
   `app/(admin)/admin/AdminNav.tsx`. Also inspect the latest migration/journal
   conventions and customer magic-link/contact linkage.
2. Add the guidance schema and service. Key progress by user, flow key and flow
   version; keep flow definitions versioned and evaluate eligibility from the
   actor's effective grants. Define outcome predicates that query real product
   state and recompute completion safely.
3. Define a capability-to-step registry for the six shipped roles while also
   supporting custom roles with equivalent grants. Keep role audience as a
   targeting hint, not an authorization decision.
4. Add accessible admin and portal guidance surfaces with progress, explicit
   skip/dismiss, reset and contextual relaunch. Inaccessible actions must be
   absent, not disabled.
5. Fix the admin overview's unconditional capability reads as part of the
   permission-safe experience, then add service, permission, accessibility and
   real-browser journey tests.
6. Run the full local gates, update `MASTER.md`, and use the signed PR/CI/merge
   flow only after the C1.25 acceptance statement is proven.

Candidate first-win outcomes still need a final capability audit before being
locked down. Likely anchors are published content for editors, contact work for
service providers, read-only business insight for bookkeepers, a delegated
administrative outcome for administrators, an owner setup/security outcome,
and an actual privacy/profile outcome for customers. Do not force a role into
an action its effective grants cannot perform.

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
