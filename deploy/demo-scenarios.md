# Deterministic demo scenarios

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0

Freeholder demo scenarios are versioned product definitions, not disposable
database scripts. An owner reaches them at **Admin -> Demo scenarios** and can
load, reload, reset or purge a scenario in one action. Every action goes
through the normal service registry, transaction, permission and audit path.

The first shipped scenario is deliberately small. `seed.current-modules@1`
assembles one visibly marked CMS page and one visibly marked form from the CMS
and Forms modules. It is the conformance foundation for later creator,
service-business, shop and everything scenarios; it does not claim that the
booking, commerce, conversation or reporting domains exist yet.

## Lifecycle and isolation

Only one demo run may be active. Its definition key/version, selected locale,
generation and timestamps live in `demo_scenario_runs`. Every fixture record
is mapped by run, generation, contribution key/version, stable fixture key,
subject type and exact subject ID in `demo_records`.

- **Load** is idempotent. Loading the same active key/version/locale verifies
  the existing outcomes and does not create another copy.
- **Reload** purges the current generation, verifies cleanup, advances the
  generation and loads the same run again.
- **Reset** purges the active run, marks it purged and creates a fresh run in
  the selected locale.
- **Purge** passes only stored provenance to each owning module, requires every
  handler to account for every record, verifies that the declared outcomes no
  longer exist, and marks the run purged.

The whole multi-module lifecycle is one database transaction. If a later
fixture conflicts, earlier fixture writes, provenance and the run row roll
back together. An untracked record is never adopted merely because its slug or
name resembles demo data. Purged provenance remains as lifecycle history;
ordinary business records remain untouched.

## Manifest contribution contract

A module or plugin exposes an `onboarding` loader in its module manifest. The
loaded module default-exports four typed arrays:

- `targets`: real internal hrefs, optional selectors, module dependencies and
  capabilities;
- `guidance`: versioned capability-filtered guidance flows;
- `scenarios`: versioned presets, pinned fixture versions, locales,
  prerequisites, expected tour and status;
- `fixtures`: stable record declarations, locale variants, expected outcomes,
  dependencies and service names for load, purge and verify.

Keys and handler services must stay inside the contributor's namespace. A
scenario pins every fixture version and must include all of its modules,
capabilities and locales. Expected outcomes must point at declared targets.
Load, purge and verify handlers are ordinary services, but they refuse calls
unless the run identity and supplied records match active stored provenance.

Never edit a shipped definition in place. Add a higher definition or fixture
version. Startup persists registered definitions idempotently and refuses a
key/version whose stored meaning differs.

The conformance harness in `src/core/onboarding/registry.ts` is available to
plugin development and CI. It rejects missing dependencies or handler
services, foreign namespaces, unpinned/missing fixtures, capability gaps,
undeclared outcomes and stale route/selector inventories. The hostile-plugin
tests demonstrate each refusal.

## Migration and rollback

Migrations `0041_red_zeigeist.sql` and `0042_worthless_naoko.sql` add the three
normalized tables, lifecycle constraints, definition foreign key and the
built-in version-1 scenario. They are additive. Run migrations before starting
the new image.

The previous image ignores these tables, so rollback is an image swap. Leave
the tables in place. Before uninstalling a plugin or module that owns an active
fixture, purge or reset the active scenario while its handlers are still
available.

## Post-deploy verification

1. Sign in as the owner and open **Admin -> Demo scenarios**. Confirm the
   current-module scenario names its page and form outcomes.
2. Load it in English. Confirm one `[Demo]` page and one `[Demo]` form appear at
   the linked admin targets.
3. Load it again and confirm no duplicate appears. Use **Reload** and confirm
   the displayed generation advances.
4. Select French or Spanish and use **Reset fresh**. Confirm the marked fixture
   copy changes locale and generation returns to one on a new run.
5. Create an ordinary page or form, then use **Purge demo**. Confirm the marked
   fixtures disappear and the ordinary records remain.
6. Run `pnpm test`, `pnpm test:browser`, the schema compatibility gate and the
   ownership restore drill for a release candidate.
