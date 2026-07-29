# Handoff: freeholder.ai track (as of 2026-07-26)

Session handoff — MASTER.md §7 step 1. Delete this file once the work lands
(it is session state, not project documentation — do not commit).

**Merged:** PR #2 (stack boot) into main. pnpm pinned to 11.1.3; supply-chain
`minimumReleaseAge` policy is active; build scripts declared via `allowBuilds`
in pnpm-workspace.yaml (esbuild: false, sharp: true).

**Merged:** PR #3 (core spine), #4 (HTTP edge), #5 (settings + CSRF).
`main` is at e3048ab. All gates green: license headers, lint (type-aware),
typecheck, 155 tests, build.

**Objective:** freeholder.ai first — the project's own site, which needs
settings/media/jobs/cms/forms/seo/analytics + an admin shell, but none of
commerce, booking, quotes, galleries or the portal. The demo with everything
on grows from the same codebase afterwards.

**Next:** `/setup` wizard UI + admin shell. Both need a visual direction,
which is the open question. After that: core/media, then cms + seo.

**Unanswered decisions:** hosting target (blocks deploy), demo isolation
policy (blocks the demo, not freeholder.ai), Stripe keys (not needed for
objective 1), visual direction (blocks the next PR).

## Where the code lives

Core:
- `src/core/service.ts` — defineService wrapper enforcing §11 invariants
  (permission → Zod parse → transaction → audit inside tx → post-commit bus);
  actor model user/agent/system/anonymous; exported `permits()`; `redact()`;
  **`ctx.call` / `ctx.callAsSystem` compose services inside one transaction**
- `src/core/module.ts` — defineModule manifest + topo-sort
- `src/core/boot.ts` — the §11 boot sequence; `boot()` / `bootOnce()`
- `src/core/manifest.ts` — core's own manifest (always on, no `requires`)
- `src/core/services.ts` · `src/core/tables.ts` — core's barrels
- `instrumentation.ts` (repo root) — Next's entry point calls `bootOnce`;
  skips the build phase so a missing secret fails the *run*, not the build
- `src/core/db/index.ts` — lazy pool, `closeDb()`, `isUniqueViolation()`
- `src/core/auth/{schema,passwords,sessions,service}.ts`
- `src/core/contacts/{schema,service}.ts`
- `src/core/events/{schema,index}.ts`
- `src/core/settings/{schema,service}.ts` — business profile singleton + toggles
- `src/core/http/{cookies,actor,respond,route,csrf}.ts` — the HTTP edge
- `app/api/{setup/owner,auth/login,auth/logout,auth/session}/route.ts`
- `src/core/i18n/index.ts` + `locales/en.json`
- `db/migrations/0000_core-spine.sql`, `0001_business-profile.sql` (both applied
  to freeholder_dev and freeholder_test)

Tests (new): `vitest.config.ts`, `tests/setup/migrate.ts`,
`tests/helpers/spine.ts`, `tests/core/{i18n,passwords,module,service,
db-errors,boot,spine}.test.ts`, plus additions to `src/core/env.test.ts`.

Gates: `eslint.config.mjs` is now type-aware and carries the §15.4 money gate
and a §15.5 rule covering the Drizzle client and driver, not just schemas.
`scripts/license-headers.mjs` (+ `pnpm license:check` / `license:fix`, wired
into CI) enforces the LICENSING.md two-line header and the AGPL/MIT boundary.

Also: `.changeset/spine-and-service-registry.md`, `PROJECT_BACKLOG.json`
entry, two new CLAUDE.md non-negotiables.

## Local environment (this machine)

Postgres 16.13 on localhost:5432, user `postgres` / password `postgres`
(psql at `C:\Program Files\PostgreSQL\18\bin\psql.exe`). Databases
`freeholder_dev` (empty) and `freeholder_test` (migrated). `.env` has
DATABASE_URL, TEST_DATABASE_URL, SESSION_SECRET. No docker.

Tests map **TEST_DATABASE_URL → DATABASE_URL**; without it, DB-backed tests
skip rather than touch the dev database. CI (`CI=true`) falls back to its own
DATABASE_URL. Migrations run from `tests/setup/migrate.ts` (globalSetup), so
CI needs no migrate step.

## Known open items (in PROJECT_BACKLOG.json, deliberately not in this PR)

- **Event bus is in-process**: events are lost if the process dies between
  commit and publish. pg-boss is already a dependency if an outbox is wanted.
- `updatedAt` is hand-maintained in `contacts.update` only.
- Boot does not mount routes, jobs or MCP tools — no such surfaces exist yet.
- The FX-inside-charge-paths half of the money gate awaits an fx adapter.
- **No rate limiting** on login or setup; brute force is unbounded.
- `contacts.resolve` never updates an existing contact (§4.6 wants update too).
- `contacts.merge` orphans the duplicate's `users` row when both have a login.
- No expired-session sweep — needs core/jobs.

## Deferred to later §7-step-1 PRs

media, jobs (pg-boss wrapper), locations/NAP, setup wizard UI (`/setup`),
admin shell, scripts/doctor.ts, seed ("Aurora Coast Photography"), OTP
(otp_secret column already exists), EntityTranslation table.

## Design decisions (so the next session doesn't re-litigate)

- audit_log lives in `src/core/events/schema.ts`.
- Queries (`kind: "query"`) skip audit writes; mutations audit inside the tx.
- Timeline events write inside the tx; module bus events publish post-commit,
  and only the *outermost* call publishes.
- Agent scopes: exact service name or `<module>.*` wildcard. `permission:
  "public"` short-circuits before scopes — same reach anonymous already has.
- login returns identical errors for unknown email, wrong password, and
  malformed input; it does **not** reuse the registration schema.
- One contact per email (unique index). `contacts.create` is for humans;
  automated paths call `contacts.resolve`. `contacts.merge` is a
  hand-maintained FK list — every new `contact_id` column must be added.
- `registerOwner` is made once-only by a partial unique index, not by the
  count check (which cannot see an uncommitted peer).
- `logout` takes the token, never a session id.
- Money is `(amount_minor_units, currency)`; `formatMoney` reads the exponent
  from the currency and never divides.
- Drizzle wraps driver errors — check Postgres codes with `isUniqueViolation`,
  which walks `.cause`.
- `audit_log.subject_id` / `timeline_events.subject_id` are **text**, not uuid:
  subjects are polymorphic (a contact id, a module name, a singleton id).
- The business profile is one row pinned by a check constraint (`id = 1`).
- CSRF applies to unsafe methods only when a session cookie is present, so
  login and first boot need no token.
- Zod `.partial()` does **not** strip `.default()` — build patch schemas from a
  shape with no defaults, or patching silently resets fields.
- Regenerating an already-applied migration requires dropping and recreating
  the target schema; the test DB was reset once for exactly this.
