// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Rewrite packages/sdk/src/generated.ts from the live service registry (C3.03).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(join(root, ".env")); } catch { /* Optional test configuration. */ }
}
// C3.03/C11.15: seven transport tests passing says nothing about whether the
// live registry ran. Refuse before touching an artifact if it would skip.
if (!process.env.TEST_DATABASE_URL && !(process.env.CI && process.env.DATABASE_URL)) {
  console.error("SDK generation requires TEST_DATABASE_URL (or CI DATABASE_URL) pointing at a disposable database; the live registry cannot be skipped.");
  process.exit(1);
}
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
writeFileSync(
  join(root, "packages", "sdk", "src", "version.ts"),
  `// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Kept in lockstep with the platform package.json version (C3.20).
export const PLATFORM_VERSION = ${JSON.stringify(version)};
`,
);
const directory = mkdtempSync(join(root, ".sdk-generation-"));
try {
  const reportPath = join(directory, "results.json");
  const result = spawnSync(
    // A fixed command and a generated relative basename also work with
    // pnpm.cmd on Windows; no shell-interpolated user paths or arguments.
    `pnpm exec vitest run --reporter=dot --reporter=json --outputFile.json=${basename(directory)}/results.json tests/core/sdk.test.ts`,
    {
      cwd: root,
      shell: true,
      env: { ...process.env, UPDATE_SDK: "1" },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error(`SDK test runner failed (${result.status ?? result.error?.message}).`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const generated = report.testResults?.flatMap((file) => file.assertionResults ?? [])
    .find((test) => test.title === "is regenerated from listExternalServices and refuses drift");
  if (generated?.status !== "passed") {
    throw new Error("The live SDK catalog was not generated; skipped tests are not generation evidence.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
