<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Handoff — 2026-08-28

Written for whoever picks this up next, human or agent. `MASTER.md` remains the
only source of truth for product, architecture and status; this document is a
snapshot of *where the work is* and *what is worth knowing that the code does
not say out loud*. If the two ever disagree, MASTER wins and this file is stale.

---

## 1. Where things stand

**Plan gate: 189 of 274 checked, 85 open.** Run `node scripts/plan-gate.mjs` for
the live number — it is the only count that is not a guess.

### Landed on `main`

Seven PRs merged on 2026-08-27/28, each green across all eighteen CI steps:

- **#207** C7.12–C8.02, plus the CI repair described below
- **#208** C8.03 private client galleries, and an audit of them
- **#209** C8.04 watermarked variants and a `download_policy` that is read
- **#210** C8.05 client proofing (`GallerySelection`)
- **#211** C8.06 approval rounds
- **#212** C8.07 archive delivery and its notifications

**192 of the 274 §43 items are checked; 82 remain.**

### In flight: a three-deep stack

Three branches are committed, locally verified, and stacked — each on the
one before it, so they merge in order and each needs `main` merged in after
the one below it lands:

- `feat/c8.08-gallery-sales` — **#213**, C8.08 print and digital sales
- `feat/c8.09-reviews` — C8.09 collected customer feedback, no PR yet
- `feat/c8.10-portal-shell` — C8.10 the customer portal shell, no PR yet

The two without PRs are deliberate: opening them now would show cumulative
diffs against `main` and re-run three full pipelines for one change. Open
each once the one below it has merged. All three carry the SIGPIPE fix in
item 7 below, cherry-picked, so their first pipeline is not exposed to it —
expect that commit to be a no-op by the time the upper two merge.

### The CI pipeline was not running

This is the thing most worth knowing. **Twelve of the eighteen CI steps had
never once executed.** A failure at step 12 (`Test`) short-circuited the job,
so everything after it — Build, the artifact boundary, the browser gate, the
deploy recipes, the SEO and upgrade gates — had been decorative for a long
time. Fixing one failure only ever revealed the next:

1. `galleries.expireSessions` was missing from the reviewed system-service
   inventory in `tests/core/internal-services.test.ts`. **Any new**
   **`permission: "system"` service must be added there** or CI fails.
2. The Build step had no `SESSION_SECRET`. `next build` prerenders, and
   prerendering calls `env()`, which refuses to resolve in production without
   one. It is now a build-only value in the workflow's job env.
3. The standalone artifact cap was 200 MiB and the artifact is larger. Note
   the trap: the baseline is **platform-dependent** — the same commit measures
   ~205 MB on Windows and ~218 MB on CI's Linux, because the native image
   binaries differ. A cap calibrated locally passes locally and fails in CI.
4. The browser gate's fixture registered one module's blocks by hand, and
   C8.02 added a portfolio index to a seeded template. It now registers every
   module's block list. `ready()` cannot be used there: boot resolves modules
   through dynamic `@/` imports and Playwright only rewrites static ones.
5. The Tier-1 recipe gate asked Doctor a privileged question with a
   half-authenticated session. An owner holding the wildcard grant makes
   two-factor mandatory, so `permits()` refuses every scoped service until the
   session is enrolled; `doctor.mjs --enroll-totp` is the fix, and
   `public-gates.sh` had been doing it all along.
6. The same gate then exited on Doctor's status code rather than its verdict.
   `env.appUrl` fails in a throwaway container and should: it is a production
   build on localhost. It now reasons about *which* checks failed.
7. Both the recipe gate and the public gates waited for the demo with
   `docker logs <container> | grep -q "demo installed"`, which is a SIGPIPE
   trap under `set -o pipefail`: `grep -q` exits on the first match, docker —
   still writing — dies on the closed pipe, and the pipeline reports 141. It
   presents as `Process completed with exit code 141` with **no failing**
   **assertion anywhere in the log**, and it is a race, so it passes on
   re-run. It cost two red builds (#211, #213) before the pattern was clear.
   **Never pipe a long-running writer into an early-exiting reader in a**
   **`pipefail` script.** Capture into a variable and match with `[[ ==
   *glob* ]]`. Piping from `echo` is fine; the writer is already finished.

A red build with nothing failing in it is the signature of the environment,
not of the code — check for 141 before you go looking for a regression.

**Run `pnpm gates` before every push.** It runs everything CI checks that is
cheap: typecheck, lint, license headers, the changelog gate, the plan gate,
and the static-contract suites (locale/RTL, token contrast, block fields,
CMS a11y, the a11y smoke test, the internal-service inventory). About four
minutes, and lint is most of it. Three separate red pipelines in this
session were things on that list, each reported locally in seconds by a gate
that was already in the repository — the gates were not missing, running
them was. A green `pnpm gates` means "nothing cheap is broken", never "CI
will pass": the browser, recipe, SEO and upgrade gates are not in it,
because they cannot run here at all.

**Do not calibrate any of these limits from a local run.** Docker is not
installed on the development machine, so the recipe, SEO and upgrade gates
cannot be exercised locally at all; CI is the only place they run.

### Next item

**C8.11** — fill the portal rooms C8.10 deliberately left out: quotes,
contracts, invoices and payments; bookings, events and rentals; galleries
and files; orders and returns; subscriptions and passes; loyalty and
referrals; messages. Each reads through the same services admin uses —
the portal is a second audience for them, never a second implementation.
Do not start it on top of the stack above; land the stack first, or it
becomes four deep.

`RESTART_HANDOFF.md` is pre-existing untracked scratch. Do not modify or stage
it.

### Deploying freeholder.ai

Not wired up, and worth stating plainly so nobody assumes otherwise. Merging
to `main` publishes a signed container image (`publish-image.yml`) — that is a
release artifact, **not** a deployment. Nothing in this repository puts code
onto the server.

What is known: `freeholder.ai` resolves to `143.198.54.199`, the
`freeholder-prod` droplet in DigitalOcean's `sfo3`, under the `campdenman`
doctl context — consistent with `S3_REGION=sfo3` and the `freeholder-media`
bucket. The intended home for a deploy pipeline is the in-house Forgejo at
`forge.paradisemodern.com:2222`, **not** GitHub, because this repository is
public and a deploy script carries host addresses that are not secrets.
`../paradisemodern/.forgejo/workflows/` is the working model.

Two things block it: no `freeholder` repository exists on that forge
(push-to-create is disabled for organizations and the API needs a token), and
nobody has recorded how the app actually runs on that droplet — Docker
Compose, systemd, what terminates TLS. `remote-deploy.sh` is 173 lines of
assumptions about exactly those things, so it must not be copied blind.

### Evidence, and what is not evidence

The five merged PRs each passed all eighteen CI steps, which is the only
claim worth making: it covers lint, typecheck, the full suite, the
ownership drill, the build, the artifact boundary, the browser gate, both
deploy-recipe steps, the Tier-1 matrix, SEO, schema compatibility and the
changelog gate.

Locally, `pnpm test` takes long enough that it is usually run in shards
(`--shard=1/8` … `8/8`); a full local run is roughly 45 minutes and a full CI
run roughly 90. **Do not run two suites at once against the same database** —
`truncateSpine` will truncate the other run's fixtures and produce failures
that look like real bugs. That happened during this work and cost an hour
chasing a duplicate-key error that was self-inflicted.

The browser a11y gate *can* be run locally without Docker, and is worth doing
before pushing anything that touches an admin screen:

```
npm run build
npx playwright test tests/browser/accessibility.spec.ts --config playwright.a11y.config.ts
```

---

## 2. How to work here

Read `CLAUDE.md` first — it is short and every line of it is load-bearing. The
rules that bite most often in practice:

- **Name the §43 checklist ID in every product change.** The plan gate enforces
  that the IDs exist and are contiguous; it cannot enforce that you named the
  right one.
- **Tick a box only with the evidence §43.2 requires**, and write the evidence
  note in the same PR. The notes on checked items are the only record of *why*
  something is the way it is.
- **Never `git add -A`.** Stage explicit paths. `RESTART_HANDOFF.md` in the repo
  root is scratch and must never be committed.
- **`git commit -s`** — DCO, no CLA.
- **`main` is protected.** PR + green checks, squash-merge, do not delete
  branches.

### The per-item loop that works

1. Read the §43 item *and* the §§1–42 section it points at. The item is a
   pointer; the section is the specification.
2. Build, with the reasoning in the comments — see §5 below on what that means
   here.
3. Write the test file as a set of *claims*, one per rule the design makes.
4. Run the gates (§3 below). Fix. Re-run.
5. Tick MASTER with an evidence note naming the decisions and the migration.
6. Changeset in `.changeset/`, written for a business owner, not a developer.
7. Commit signed off, push, open the PR, restack, merge when green.

### A hard-won operational note

**Do not run two `vitest` suites concurrently against the local Postgres.** They
contend on `truncateSpine()` and deadlock: one run this session reported a
6,800-second duration and spurious failures that vanished on a serial re-run.
Symptoms are a hang in `beforeEach` at `ready()`. Run suites one at a time.

Long runs should go to the background (`run_in_background`) with a `Monitor`
watching for a completion marker — a plain `sleep` is blocked.

---

## 3. The gates, and what each one has actually caught

Run these before claiming anything is clean. Every one of them exists because
something got through:

| Gate | Command | Caught, historically |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | — |
| Lint | `npx eslint .` | unnecessary assertions, `[object Object]` stringification |
| Licence headers | `node scripts/license-headers.mjs` | missing SPDX on new files |
| Plan consistency | `node scripts/plan-gate.mjs` | invented checklist IDs that no §43 item defines — including one in an early draft of *this* file |
| Schema compat | `node scripts/schema-compat-gate.mjs origin/main` | an unlabelled `DROP TABLE` |
| Migration journal | `tests/core/migration-journal.test.ts` | two branches colliding on one `when` — a **silently skipped migration** |
| Registry completeness | `tests/core/registry-completeness.test.ts` | unregistered services; a half-retired table (C7.07) |
| Merge completeness | `tests/core/merge-completeness.test.ts` | **three** unregistered `contact_id` tables this session |
| Route boot | `tests/core/route-boot.test.ts` | a production 500 on `/ics/*` — routes missing `await ready()` |
| i18n / RTL | `tests/core/i18n-gate.test.ts`, `locale-quality.test.ts` | `ml-auto` instead of `ms-auto`; ICU parse failures on literal `{{…}}` |
| Tokens / a11y | `tests/core/tokens.test.ts`, `a11y-smoke.test.ts` | contrast failures in one scheme |

**The merge-completeness gate is the one to respect most.** A module that adds a
`contact_id` column must repoint it in `contacts.merge` *and* register it with
`registerContactPrivacySource`. It caught three omissions this session. A table
missing from that list orphans rows the first time an owner merges two
duplicates — the exact silent fork the contact spine exists to prevent.

---

## 4. Decisions made this session that are expensive to reverse

These are not in the code comments' scope, or are spread across several files.
Anyone changing this area should know them.

### 4.1 Tasks, notes and segments live in **core**, not the `crm` module

§11's tree sketched all three under `platform/crm`. They are in `core/tasks`,
`core/notes` and `core/segments` instead, and §11 is amended to say so.

The reason: §4.14 attaches a task and a note to a contact, deal, invoice,
booking and project — five owners across four modules. Putting the one work list
inside any of them would make every other module depend on that one to have a
to-do. The projects module's operational links therefore remain polymorphic
and import none of quote/booking/invoice/rental; C8.01 adds only the CMS
dependency needed for its public snapshot, not a dependency on every kind of
record a project can attach.

**The rule, stated once:** anything several modules must read, or that core
itself reads, belongs to the spine.

### 4.2 §4.14 contradicted itself about conversations, and C7.08 settled it

The entity row said a `Conversation` is *"one thread with one person on one
channel"*. The inbox rule twenty lines earlier said a form submission, the email
reply to it and a text about the same job *"belong in one conversation"*.

Resolution, now written into §4.14: **a message carries the channel it arrived
on and never changes; a conversation carries the channel a reply would use, and
that follows the last thing that happened.** Both sentences are now true.

### 4.3 C7.04 was split, and C7.17 is new

The original C7.04 required segments to be reused by "pricing, campaigns,
automation and reporting". Three of those four do not exist yet — broadcasts are
  C9.06, automations C9.01, reporting C9.08. Ticking an item whose evidence cannot
exist is what §43 forbids; leaving the model unbuilt until C10 would let each
surface grow its own answer to "who" as it landed.

So C7.04 is the model plus pricing, and **C7.17** is the adoption the other
three owe when they arrive. It is dependency-blocked and says so. The plan is
271 IDs, not 270, because of this.

### 4.4 C6.15's `project_tasks` was folded into `core/tasks`

Rows copied in `0102_tasks.sql`; `projects.addTask` now writes through
`tasks.create`. **The old table is still in the database**, deliberately — the
schema-compat gate is right that dropping it in the same release breaks
rollback. The contract half is one `DROP TABLE project_tasks` in a later
release, and the note sits where the definition used to be in
`src/modules/projects/schema.ts`.

### 4.5 `core/contacts/lifecycle.ts` is an inverted-dependency seam

Scoring (core) must move people along the lifecycle, but C7.01 made
`crm.moveContactStage` the single write path and **core may not import a
module**. So core asks whatever advancer is registered and the CRM registers
one; with no CRM installed the fallback writes the enum directly, which is
correct because there is no fine stage to keep in step. Same shape as briefing
contributors, contact references and segment fields.

### 4.6 Reply refuses rather than queues

`conversations.reply` refuses on a channel with nothing able to send, rather
than recording a message that never leaves. Words sitting in a thread the
customer never saw are worse than an error somebody can act on. C7.10 connected
SMS; C7.15 connects chat only while a valid browser session exists. WhatsApp
and Messenger are deliberately external deep links, not provider inboxes, so a
`social` reply still refuses instead of claiming delivery.

### 4.7 Carrier registration is derived, never stored

`requirementsFor(country, kind)` in `core/messaging/registration.ts` is a pure
function, and nothing writes what a number *needs* — only how far along each
registration has got. A stored requirement is one an owner could clear, and
carrier policy is not theirs to waive.

The rules are US and Canadian carrier policy **as of 2026 and they will change**.
They sit in that one function with one test file precisely so the correction is
one diff. The sender-ID country list is an allow-list rather than a deny-list:
the honest default for a country nobody has checked is "we do not know", and an
allow-list fails towards refusing to send rather than towards sending into a
silent filter.

The refusal happens in `senderFor`, so it covers every send path rather than a
screen. It refuses rather than warns, because the failure being prevented is a
message that looks sent and is not — and a warning somebody clicks past
reproduces that exactly.

### 4.8 Contact import reverses by asking Postgres, not the merge list

`hasOtherHistory` queries `pg_constraint` for every column referencing
`contacts.id`, because the merge list says which tables repoint and *how*, not
which column holds the reference — and `contact_relationships` has two under
different names. `timeline_events` and `contact_import_rows` are excluded and
commented: both are written *by* the import, so counting them would mean nothing
could ever be undone.

---

## 5. What "done" looks like in this codebase

This is the part hardest to infer from a diff.

**Comments explain the decision, not the mechanism.** `// increment the counter`
is noise. `// Stamped in the statement that finds it, so two workers racing
cannot both take the same task` is the reason somebody cannot safely change it.
Where a rule comes from MASTER, quote the sentence.

**Every constraint has a failure it prevents, and the comment names it.** A check
constraint with no comment is a rule nobody can safely remove later.

**Tests are claims, not coverage.** Each test file opens with the rules the
design makes and why each one matters; each test is one of those rules. A test
called "works correctly" teaches nothing when it fails at 2am.

**Owner-facing copy is written for the owner.** "That did not work. Nothing has
changed." — not "Error: validation failed". Three locales (en/es/fr), every
string through `t()`, ICU for plurals.

**No JavaScript required.** Every admin surface built this session works with
forms and links alone — kanban boards, bulk inbox actions, column pickers. A
board an owner cannot use on a phone with a bad signal is not a board.

**Both themes, always.** Semantic tokens only, never a literal, and both must
clear WCAG AA — `tests/core/tokens.test.ts` fails the build otherwise.

---

## 6. Is the remaining plan detailed enough?

Honestly: **the checklist is not, deliberately, and mostly that is fine — but it
had three real holes, now filled.**

The 90 open items have a median length of roughly 16 words. They are *pointers* into
§§1–42, which is ~35,000 words of specification (§4 alone is 9,900). The detail
is meant to live there; CLAUDE.md explicitly forbids creating a second roadmap,
and expanding 90 one-liners would duplicate the spec and give two places to be
wrong.

I audited every open block against the sections it points at. Coverage is
substantive for automations (17 mentions), loyalty (17), referrals (16),
subscriptions (28), entitlements/paywalls (20), campaigns (24), reporting (34),
galleries (28), reviews (48) and the portal (16). Self-update has §39 at 2,000
words for its eleven items.

**Three gaps were real, and are filled in this change:**

| Gap | Items affected | Filled with |
|---|---|---|
| Mobile app had 208 words for 7 items | C10.12–C10.18 | **§35.1** — what the app may hold, discovery, auth, offline (read-through, write-never), push as a notification channel with a `DeviceToken` entity, and what it deliberately does not do (no in-app purchase, no analytics SDK) |
| Help centre had 2 passing mentions | C8.12 | **§4.6** — `HelpArticle` / `HelpCategory` as CMS entities, plus the three rules (trigram search, two counters and no comment box, indexable by default) |
| "Defined performance budgets" defined nowhere | C11.11 | **§15.1** — thirteen budgets with numbers, the dataset and hardware they are measured on, why each number, and the rule that raising one needs a written reason |

That last one mattered most: C11.11 was literally uncompletable, because it
asked for budgets to be met that no document stated.

**What is still thin but defensibly so:** C11.10 ("independent security review")
and C11.12 (WCAG AA) name external standards rather than internal specs, which is
correct — the standard is the specification. C9's thirty items lean on §30 and
§36, which are substantial but written as narrative rather than entity tables;
expect to make more shape decisions there than in C7, and record them in the
evidence notes as C7.08 did.

---

## 7. Open pull requests, and what is actually true about them

At the time of writing, nine PRs are open and **none of them is simply "ready"**.
The important discovery: a green tick on a Dependabot PR proved nothing, because
they had all last run on **2026-08-21**, before C7.01–C7.10 added ~15,000 lines,
three core modules, an adapter and a dozen migrations.

I rebased eight of them onto current `main` to get honest evidence. All eight
then passed — including both **major** bumps (TypeScript 6, `@types/jsdom` 30).
Two have since merged (#85, #79).

| PR | State | What to do |
|---|---|---|
| #86, #87, #88, #80, #108, #109, #83 | fresh CI green, now `BEHIND` again | Merge one at a time: `gh pr update-branch <n> --rebase`, wait for CI, `gh pr merge <n> --squash`. The repo requires up-to-date branches, so this is inherently serial |
| #110 (Next 16.3.1) | **failing, genuinely** | Turbopack reads `@img/sharp-libvips-linux-x64` as a file when it is a directory and the build dies. Upstream regression — leave it |
| #198 (seed packs) | another session's | Last *completed* run failed; a newer one was in progress. Not ours to land |

Two notes worth carrying:

- **Serial merging is a feature here, not just a constraint.** Each PR is rebased
  and re-verified immediately before it merges, so whichever lands second is
  tested against the first. #109 and #108 were each verified against `main` in
  isolation — TypeScript 6 with typescript-eslint 8.65, and 8.67 with TypeScript
  5.9.3 — a combination neither run covered. The rebase-before-merge cycle closes
  that gap by construction.
- **`pg-boss` 12.27.0 was read, not just tested.** It is a runtime dependency and
  the release is entirely about schema-name handling. Freeholder uses
  `schema: "pgboss"` — bare and already lower-case — which the release notes put
  squarely in the unaffected case, and derived values (notify channel, advisory
  lock key) stay byte-identical so rolling upgrades still coordinate.

## 8. Things I would check early

- **`RESTART_HANDOFF.md`** is untracked scratch in the repo root. It is not this
  file. Leave it alone or delete it; never stage it.
- **The `none` SMS adapter is not a placeholder.** It is what an unconfigured
  instance resolves to, and it refuses clearly. Do not remove it when adding a
  second provider.
- **`messages.provider_ref` and `contact_score_awards` have partial unique
  indexes** used as concurrency guards, not as validation. Code catches the
  violation and treats losing the race as success. Do not "helpfully" convert
  them to read-then-write.
