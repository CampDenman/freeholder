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
// Browser gates need a built app and a disposable database; recipe, SEO and
// upgrade gates need Docker. They run separately from this inexpensive pass.
// A green run here means "nothing cheap is broken", never "CI will pass".
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingContractEvidence } from "./contract-evidence.mjs";

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
      "tests/core/sdk-schema.test.ts",
      "tests/core/merge-completeness.test.ts",
      "tests/core/registry-completeness.test.ts",
      "tests/core/docs-availability.test.ts",
      "tests/core/plan-gate.test.ts",
      "tests/core/contract-evidence.test.ts",
      "tests/core/mobile-screens.test.ts",
      "tests/core/mobile-app-shell.test.ts",
      "tests/core/freeholder-app-init.test.ts",
      "tests/core/mobile-private-cache.test.ts",
      "tests/core/standalone-artifact.test.ts",
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
      "tests/core/long-running-service-boundary.test.ts",
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
  const reportDirectory = step.name === "contract suites"
    ? mkdtempSync(join(tmpdir(), "freeholder-contracts-"))
    : null;
  let ok;
  try {
    const reportPath = reportDirectory && join(reportDirectory, "results.json");
    const command = reportPath
      ? `${step.run} --reporter=json --outputFile.json="${reportPath}"`
      : step.run;
    const result = spawnSync(command, { stdio: "inherit", shell: true });
    ok = result.status === 0;
    if (reportPath) {
      try {
        const files = step.run.split(" ").filter((arg) => arg.endsWith(".test.ts"));
        const missing = missingContractEvidence(files, JSON.parse(readFileSync(reportPath, "utf8")));
        if (missing.length) {
          console.error(`No passing tests in required contract files: ${missing.join(", ")}`);
          ok = false;
        }
      } catch (error) {
        console.error(`Cannot verify contract test evidence: ${error.message}`);
        ok = false;
      }
    }
  } finally {
    if (reportDirectory) rmSync(reportDirectory, { recursive: true, force: true });
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (!ok) failed.push(step.name);
  console.log(`${ok ? "ok  " : "FAIL"}  ${step.name} (${seconds}s)`);
}

if (failed.length) {
  console.error(`\n${failed.length} gate(s) failed: ${failed.join(", ")}`);
  console.error("Fix these before pushing; each one is a red pipeline otherwise.");
  process.exit(1);
}
console.log("\nSelected fast gates pass. Browser, recipe, SEO and upgrade gates require separate runs.");
