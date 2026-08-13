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

The branch was created, and a broad repository search was about to begin when
shutdown was requested. No audit conclusion should be inferred yet. Start by
inspecting, at minimum:

- `src/core/roles/` and the role/grant services and tests;
- invitation acceptance and role assignment;
- `app/(admin)/admin/` layout, guard, dashboard and settings surfaces;
- setup completion and the new seeded-demo claim path;
- portal/customer authentication and layout;
- existing task/job/notification primitives that might support first-win
  progress without creating a second task model;
- locale catalogs and existing real-browser accessibility/journey fixtures;
- module manifests and capability checks, because onboarding must be derived
  from effective access rather than hardcoded role labels.

Suggested first commands:

```powershell
git status --short --branch
rg --files | rg 'onboard|tour|checklist|progress|role|grant|capabil|task|setup|invitation|portal'
rg -n -C 8 'C1\.25|onboarding|first-win|contextual relaunch|skip/reset|progress|forbidden-control' MASTER.md src app tests deploy locales
```

Before implementation, define an explicit capability-to-onboarding-step map,
the durable progress/reset model, relaunch entry points for each shell, and the
permission rule proving that inaccessible controls are absent rather than only
disabled. Preserve the distinction between first-boot setup and ongoing,
resumable onboarding.

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
