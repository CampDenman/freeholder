// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Lint IS the architecture police (MASTER.md §2 principle 11, §15, §16):
// every boundary rule agreed in the master doc that can be machine-checked
// lives here, not in tribal knowledge.
import tseslint from "typescript-eslint";

// The gates are named arrays rather than written inline because ESLint's flat
// config *replaces* a rule's options when a later block sets the same rule for
// overlapping files — it does not merge them. Writing the i18n gate inline for
// `src/ui/**` silently switched the money gate off there, which is the kind of
// hole a gate is supposed to close rather than open. Composing the arrays
// makes the overlap explicit and impossible to get wrong by accident.

// Money gate (MASTER.md §15.4). Money is integer minor units; the only way it
// becomes a float is division, rounding helpers, or float parsing. Adding and
// subtracting minor units is correct and stays legal — this bans the
// operations that lose a cent, not arithmetic.
const MONEY_GATE = [
  {
    selector:
      'BinaryExpression[operator="/"] > Identifier[name=/([Cc]ents|[Mm]inorUnits|[Aa]mount)$/]',
    message:
      "Money is integer minor units (MASTER.md §15.4): dividing it produces a float. formatMoney() renders it without ever dividing.",
  },
  {
    selector: 'CallExpression[callee.property.name="toFixed"]',
    message:
      "toFixed() rounds in floating point (MASTER.md §15.4). Format money with formatMoney().",
  },
  {
    selector: 'CallExpression[callee.name="parseFloat"]',
    message:
      "parseFloat() introduces float error (MASTER.md §15.4). Money is parsed and stored as integer minor units.",
  },
  {
    selector:
      'CallExpression[callee.object.name="Number"][callee.property.name="parseFloat"]',
    message:
      "Number.parseFloat() introduces float error (MASTER.md §15.4). Money is parsed and stored as integer minor units.",
  },
];

// The i18n gate (MASTER.md §15.3): user-facing text must pass through the
// string layer. §2 principle 9 calls retrofitting i18n "the single most
// expensive refactor a platform can face" — this is what keeps the retrofit
// from being needed a second time.
//
// It catches the two shapes copy takes in JSX: a bare literal between tags,
// and a literal handed to an attribute that is rendered or announced.
//
// Client components cannot call `t` — the catalogs are server-side and the
// locale is resolved per request — so they take their strings as props. That
// is what makes a rule this blunt workable.
const I18N_GATE = [
  {
    // Two or more letters in a row: skips punctuation, arrows, dashes and the
    // whitespace JSX is full of, catches every real sentence.
    selector: "JSXText[value=/[A-Za-z]{2,}/]",
    message:
      'User-facing text must come from the string layer (MASTER.md §15.3). Use {t("some.key")} in a server component, or take the string as a prop in a client component.',
  },
  {
    selector:
      'JSXAttribute[name.name=/^(label|placeholder|title|alt|hint|summary|legend|aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext)$/] > Literal[value=/[A-Za-z]{2,}/]',
    message:
      "This attribute is read by a person or a screen reader, so it must come from the string layer (MASTER.md §15.3) rather than a literal.",
  },
];

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "packages/**", "db/**"],
  },
  // Type-aware from here down. Several gates in §15 are statements about
  // values, not syntax, and cannot be written without the type checker.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Config and script files live outside the TypeScript program.
    files: ["**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      // Framework-free below app/: src/ is the application, app/ is the
      // routing skin. A future framework migration must be a chore, not a
      // rewrite.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "src/ is framework-agnostic (MASTER.md §10): Next.js imports belong in app/ only.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...MONEY_GATE],
    },
  },
  {
    files: ["app/**/*.ts", "app/**/*.tsx"],
    rules: {
      // Service-layer gate (MASTER.md §15.5): routes call services, never the
      // database. Blocking only the schema modules left the front door open —
      // a handler could take the Drizzle client itself and issue raw SQL,
      // skipping permissions, validation, the audit trail and the timeline.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/core/db",
                "@/core/db/*",
                "@/core/*/schema",
                "@/modules/*/schema",
                "drizzle-orm",
                "drizzle-orm/*",
                "postgres",
              ],
              message:
                "Route handlers never reach the database directly (MASTER.md §15.5) — call the service layer.",
            },
          ],
        },
      ],
    },
  },
  {
    // The rendered surfaces carry both gates. `src/ui/**` overlaps the src/
    // block above, so the money gate is restated here rather than lost.
    files: ["app/**/*.tsx", "src/ui/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...MONEY_GATE, ...I18N_GATE],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Core's contracts require async functions by signature — a service
      // handler and a manifest's lazy loaders must return promises whether or
      // not their body happens to await. The rule would push those toward
      // hand-rolled Promise.resolve wrappers, which is worse code for no gain.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
