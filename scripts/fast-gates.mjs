// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
//
// Everything CI checks that is cheap enough to run before pushing.
//
// This exists because of a specific, repeated cost: a lint error and two
// static-contract failures each cost a full ~30-minute pipeline to discover,
// and every one of them was reported locally in seconds by a gate that was
// already in the repository. The gates were not missing. Running them was.
//
// What this is NOT: the browser, recipe, SEO and upgrade gates need Docker or
// a built app and cannot run on the development machine at all (see
// HANDOFF.md). A green run here means "nothing cheap is broken", never "CI
// will pass". It is the first filter, not the last word.
import { spawnSync } from "node:child_process";

const steps = [
  { name: "typecheck", run: "pnpm exec tsc --noEmit" },
  { name: "lint", run: "pnpm exec eslint ." },
  { name: "license headers", run: "node scripts/license-headers.mjs" },
  { name: "release notes", run: "node scripts/changelog-gate.mjs" },
  { name: "plan gate", run: "node scripts/plan-gate.mjs" },
  {
    // The static-contract suites: they assert things about the source tree
    // rather than about a database, so they are fast and they are the ones
    // that catch a new block, token, service or locale key that has not been
    // declared everywhere it has to be. Add to this list when a new gate of
    // that kind appears — the cost of it being here is a couple of seconds.
    name: "contract suites",
    run: [
      "pnpm exec vitest run --reporter=dot",
      "tests/core/locale-quality.test.ts",
      "tests/core/tokens.test.ts",
      "tests/core/cms-fields.test.ts",
      "tests/core/cms-a11y.test.ts",
      "tests/core/a11y-smoke.test.ts",
      "tests/core/internal-services.test.ts",
      "tests/core/service-composition.test.ts",
      "tests/core/social-http.test.ts",
      "tests/core/seo-surface.test.ts",
      "tests/core/cms-rich.test.ts",
      "tests/core/inline-script-safety.test.ts",
      "tests/core/outbound-boundaries.test.ts",
      "tests/core/http-body-boundary.test.ts",
      "tests/core/runtime-shutdown.test.ts",
    ].join(" "),
  },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const selected = only.length
  ? steps.filter((s) => only.some((o) => s.name.includes(o)))
  : steps;

if (selected.length === 0) {
  console.error(`No gate matches ${only.join(", ")}. Known: ${steps.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const failed = [];
for (const step of selected) {
  const started = Date.now();
  // One command string rather than argv + shell:true, which Node deprecates
  // (the args are concatenated unescaped). Nothing here takes user input.
  const result = spawnSync(step.run, { stdio: "inherit", shell: true });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  if (!ok) failed.push(step.name);
  console.log(`${ok ? "ok  " : "FAIL"}  ${step.name} (${seconds}s)`);
}

if (failed.length) {
  console.error(`\n${failed.length} gate(s) failed: ${failed.join(", ")}`);
  console.error("Fix these before pushing; each one is a red pipeline otherwise.");
  process.exit(1);
}
console.log("\nAll fast gates pass. The browser, recipe, SEO and upgrade gates still only run in CI.");
