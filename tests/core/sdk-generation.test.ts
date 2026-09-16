// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.03/C11.15: transport tests cannot stand in for generating the live SDK.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "freeholder-sdk-cli-test-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "packages/sdk/src"), { recursive: true });
  copyFileSync("scripts/generate-sdk.mjs", join(root, "scripts/generate-sdk.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.0" }));
  writeFileSync(join(root, "packages/sdk/src/version.ts"), "original version");
  const env = { ...process.env };
  delete env.TEST_DATABASE_URL;
  delete env.DATABASE_URL;
  delete env.CI;
  return { root, env };
}

describe("SDK generation evidence", () => {
  it("refuses a missing database before changing any artifact", () => {
    const { root, env } = fixture();
    try {
      const result = spawnSync(process.execPath, [join(root, "scripts/generate-sdk.mjs")], { env, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("SDK generation requires TEST_DATABASE_URL");
      expect(readFileSync(join(root, "packages/sdk/src/version.ts"), "utf8")).toBe("original version");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.skipIf(process.platform === "win32")("rejects a successful runner whose generation test skipped", () => {
    const { root, env } = fixture();
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      // No database connection or real package manager: reproduce the old
      // false-positive report at the subprocess boundary.
      writeFileSync(join(bin, "pnpm"), `#!${process.execPath}\n` +
        `const fs = require('node:fs');\n` +
        `const path = process.argv.find(arg => arg.startsWith('--outputFile.json=')).slice('--outputFile.json='.length);\n` +
        `fs.writeFileSync(path, JSON.stringify({ testResults: [{ assertionResults: [{ title: 'is regenerated from listExternalServices and refuses drift', status: 'pending' }] }] }));\n`,
        { mode: 0o755 });
      const result = spawnSync(process.execPath, [join(root, "scripts/generate-sdk.mjs")], {
        env: { ...env, PATH: `${bin}${delimiter}${env.PATH ?? ""}`, TEST_DATABASE_URL: "postgres://unused/test" },
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("live SDK catalog was not generated");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
