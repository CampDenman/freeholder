// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Lint IS the architecture police (MASTER.md §2 principle 11, §15, §16):
// every boundary rule agreed in the master doc that can be machine-checked
// lives here, not in tribal knowledge.
import tseslint from "typescript-eslint";

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
      // Money gate (MASTER.md §15.4). Money is integer minor units; the only
      // way it becomes a float is division, rounding helpers, or float
      // parsing. Adding and subtracting minor units is correct and stays
      // legal — this bans the operations that lose a cent, not arithmetic.
      "no-restricted-syntax": [
        "error",
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
      ],
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
