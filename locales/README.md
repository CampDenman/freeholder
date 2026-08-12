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

The same gate also parses and formats every message, and compares each ICU
argument and selector contract with English while allowing the plural
categories required by that language. A translation cannot
silently rename `{count}`, drop `other`, leave an empty value, or carry broken
ICU quoting into a release. `tests/fixtures/locales.ts` holds the representative
English, French and Spanish rendering fixtures; adding a selectable catalog
requires adding its fixture in the same change.

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

## Pseudo-locale and RTL checks

`en-XA` is a synthesized QA locale, not a selectable catalog. Calling
`t(PSEUDO_LOCALE, key, params)` accents and expands only the message's literal
ICU nodes, wraps the result in `⟦…⟧`, and preserves interpolated names and other
owner/customer data exactly. It is useful for finding clipped controls,
concatenated copy and text that bypassed the catalogs. It is intentionally
absent from `availableLocales()`, so it cannot leak into a production language
chooser.

The root layout derives `dir` from the locale's likely Unicode script rather
than maintaining a language list: ordinary Arabic is RTL, while explicit
`ar-Latn` remains LTR. `tests/core/locale-quality.test.ts` exercises RTL tags and
rejects physical left/right UI utilities. Use logical properties and Tailwind
utilities such as `text-start`, `ps-*`, `me-*` and `border-s-*` so a future RTL
catalog mirrors without a layout rewrite.
