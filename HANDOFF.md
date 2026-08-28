<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Handoff — 2026-08-26

Written for whoever picks this up next, human or agent. `MASTER.md` remains the
only source of truth for product, architecture and status; this document is a
snapshot of *where the work is* and *what is worth knowing that the code does
not say out loud*. If the two ever disagree, MASTER wins and this file is stale.

*This replaces the C5-era delivery log that lived here. That log had become a
second record of what shipped — the thing CLAUDE.md forbids — and every one of
the 31 checklist items it described is now covered by an evidence note in §43,
which is the record that is actually kept up to date. Nothing was lost; the
detail simply lives in one place now instead of two.*

---

## 1. Where things stand

**Plan gate: 184 of 271 checked, 87 open.** Run `node scripts/plan-gate.mjs` for
the live number — it is the only count that is not a guess.

### Current working branch

The branch is `chore/remove-proprietary-site-packs`, based on `origin/main` at
`56e0baa`. It is not committed or pushed yet. It contains:

- the removal of 21 proprietary industry packs from this open-source repo and
  an exact-hash copy under the private WeVibeSites
  `freeholder-editions/` overlay;
- C7.12 mandatory multilingual SMS consent/control words;
- C7.13 recipient-local quiet hours and frequency policy;
- C7.14 SMS templates, keywords, MMS, delivery/cost and invalid-number state;
- C7.15 bearer-isolated live chat, assistant handoff and consent-neutral
  WhatsApp/Messenger deep links.
- C7.16 owner-controlled, skippable post-signup contact import from Google,
  Microsoft, vCard, CSV and supported device selection, with exact preview,
  user-attributed undo and no implied marketing permission.
- C8.01 CMS-snapshotted project case studies with client publication consent,
  public catalog-service links, substantiated metrics, enforced before/after
  pairs, contact-backed testimonials and reciprocal service-page proof.
- C8.02 CMS-template-backed public portfolio and curated collection pages with
  normalized many-to-many membership, service/collection/text filtering,
  draft-isolated public snapshots, accessible media enforcement, sharing,
  `CreativeWork`/`CollectionPage` data and sitemap classification.

`RESTART_HANDOFF.md` is pre-existing untracked scratch. Do not modify or stage
it. The temporary `C:\tmp\wevibesites-freeholder-editions.zip` may still exist;
its cleanup was denied and it is outside both repositories.

### Next item

**C8.03** — build private client galleries with PIN/magic-link/login access,
scoped guests, expiry, per-asset permissions and access audit. The user asked
to stop before beginning this item, so no C8.03 implementation is in progress.
C7.17 remains explicitly dependency-owned by C9.01/C9.06/C9.08 and should be
checked only when those audience consumers exist.

The current cold production build passes at 9,858 standalone files /
201,458,835 bytes and includes both project-collection admin routes; the
artifact gate finds no source or environment leakage. C8.02 has 4 focused
PostgreSQL tests and a bounded 102-test project/CMS/SEO/i18n/migration/registry
regression set green, plus full lint, typecheck and licensing. The unbounded
`pnpm test` process was stopped after an extended silent run and is not claimed
as evidence. C8.01's 5 focused tests and 74 surrounding regressions remain the
prior milestone evidence. The in-app browser pass could not start because this
workstation's Codex Windows browser sandbox helper is missing. A separate local
development-server attempt also encountered the pre-existing development
database's duplicate `contacts_name_search_idx`; the isolated test database
migrates through 0118 cleanly. Do not conflate that stale dev database with the
feature or production build.

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
| Help centre had 2 passing mentions | C8.09 | **§4.6** — `HelpArticle` / `HelpCategory` as CMS entities, plus the three rules (trigram search, two counters and no comment box, indexable by default) |
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
