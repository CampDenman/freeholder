// SPDX-License-Identifier: AGPL-3.0-only
// Lint IS the architecture police (MASTER.md §2 principle 11, §15, §16):
// every boundary rule agreed in the master doc that can be machine-checked
// lives here, not in tribal knowledge.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "packages/**", "db/**"],
  },
  ...tseslint.configs.recommended,
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
    },
  },
  {
    files: ["app/**/*.ts", "app/**/*.tsx"],
    rules: {
      // Service-layer gate (MASTER.md §15.5): routes call services, never
      // tables. Schema modules are off-limits to the routing layer.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/core/db/schema", "@/core/*/schema", "@/modules/*/schema"],
              message:
                "Route handlers never import Drizzle tables (MASTER.md §15.5) — call the service layer.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
