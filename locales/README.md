# locales/ — UI string catalogs

ICU MessageFormat JSON, one file per locale (`en.json`, `fr.json`, `es.json`, …).
UI strings live here; *content* translations live in the `EntityTranslation`
table (`MASTER.md` §4.9). Native review and locale completion are tracked in
`MASTER.md` C1.17.

## Adding a locale

1. Copy `en.json` and translate the values, leaving the keys alone.
2. Import it in `src/core/i18n/index.ts` and add it to the `catalogs` record.
   The catalogs are statically imported so they reach the standalone build.
3. Run `pnpm test`. `tests/core/i18n-gate.test.ts` requires a catalog to be
   **complete** — no key missing, no key `en.json` does not have. A
   half-finished catalog fails the build rather than silently rendering English
   on the strings nobody got to.

Two things that bite:

- **Apostrophes are ICU escape characters.** A lone `'` is literal, but `'{`
  starts a quoted section and swallows the rest of the message. French is full
  of apostrophes; `tests/core/i18n.test.ts` renders several on purpose, and a
  new locale should add its own equivalent assertion.
- **Plural categories are per language.** Do not copy `one`/`other` from
  English without checking, and keep the explicit `=0` case — in most of these
  strings zero is a different sentence rather than a count.

## Translation provenance

| Locale | Status |
|---|---|
| `en` | Source. |
| `fr` | **AI-drafted, not yet reviewed by a native speaker.** |
| `es` | **AI-drafted, not yet reviewed by a native speaker.** |

The French and Spanish catalogs were machine-drafted. They are complete and
they render correctly, but "grammatical" is not the same as "sounds like a
person wrote it", and only a native speaker can tell you which one these are.
Fixing a phrase here is a genuinely useful first PR and needs no issue opened
first.

Keep this table honest: when a locale gets a native review, say so here.
