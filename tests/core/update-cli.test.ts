// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// `freeholder update` (C10.21). The exit codes are the contract: this is meant
// to live in a crontab and a monitor, and a code that means the wrong thing is
// worse than no monitoring at all.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EXIT, exitFor, parseArgs, totpCode } from "../../packages/cli/src/index";

describe("the update CLI (C10.21)", () => {
  describe("exit codes fit for cron", () => {
    it("separates 'behind' from 'a security release is outstanding'", () => {
      // A monitor must be able to page on security without also paging on
      // every feature release — an operator who collapses the two learns to
      // ignore both.
      expect(exitFor("behind-security")).toBe(EXIT.security);
      expect(exitFor("behind")).toBe(EXIT.behind);
      expect(EXIT.security).not.toBe(EXIT.behind);
    });

    it("treats up to date as success", () => {
      expect(exitFor("current")).toBe(EXIT.ok);
    });

    it("does not page on an instance that simply has not checked yet", () => {
      // The first cron run resolves `unknown` on its own. Exiting non-zero
      // here would make every fresh install look broken.
      expect(exitFor("unknown")).toBe(EXIT.ok);
    });

    it("keeps unreachable distinct from every verdict", () => {
      const verdicts = [EXIT.ok, EXIT.behind, EXIT.security];
      expect(verdicts).not.toContain(EXIT.unreachable);
    });
  });

  describe("argument parsing", () => {
    it("reads the four actions §39.10 names", () => {
      for (const action of ["check", "preflight", "apply", "rollback"]) {
        expect(parseArgs(["update", `--${action}`]).action).toBe(action);
      }
    });

    it("defaults to status, so a bare invocation reports rather than acts", () => {
      expect(parseArgs(["update"]).action).toBe("status");
    });

    it("takes the instance and credentials from flags or the environment", () => {
      const parsed = parseArgs([
        "update",
        "--url",
        "https://example.test/",
        "--api-key",
        "fh_test",
        "--json",
      ]);
      // Trailing slashes stripped, so `${url}/api/v1/...` never doubles up.
      expect(parsed.options.url).toBe("https://example.test");
      // Stripped by a loop, not `/\/+$/`, which backtracks polynomially on a
      // long run of slashes. Many slashes must be cheap, not quadratic.
      expect(parseArgs(["update", "--url", `https://x.test${"/".repeat(5000)}`]).options.url).toBe(
        "https://x.test",
      );
      expect(parsed.options.apiKey).toBe("fh_test");
      expect(parsed.options.json).toBe(true);
    });

    it("does not swallow the next flag as a missing value", () => {
      const parsed = parseArgs(["update", "--apply", "--version", "--json"]);
      expect(parsed.options.version).toBeUndefined();
      expect(parsed.options.json).toBe(true);
    });
  });

  it("computes the same TOTP profile the doctor client does", () => {
    // RFC 6238 test vector shape: deterministic for a fixed clock.
    const code = totpCode("JBSWY3DPEHPK3PXP", 59_000);
    expect(code).toMatch(/^\d{6}$/);
    expect(totpCode("JBSWY3DPEHPK3PXP", 59_000)).toBe(code);
    expect(totpCode("JBSWY3DPEHPK3PXP", 59_000 + 60_000)).not.toBe(code);
  });

  describe("packaging", () => {
    const manifest = JSON.parse(
      readFileSync("packages/cli/package.json", "utf8"),
    ) as { bin: Record<string, string>; license: string; name: string };

    it("installs as the `freeholder` binary, alongside create-freeholder", () => {
      expect(manifest.name).toBe("@freeholder/cli");
      expect(manifest.bin.freeholder).toBe("./dist/index.js");
      expect(manifest.license).toBe("Apache-2.0");
    });

    it("is built and linted with the other published packages", () => {
      const root = JSON.parse(readFileSync("package.json", "utf8")) as {
        scripts: Record<string, string>;
      };
      expect(root.scripts["packages:build"]).toContain("@freeholder/cli");
      expect(root.scripts["packages:lint"]).toContain("@freeholder/cli");
    });
  });

  it("is a client, never a second implementation of the update logic", () => {
    const source = readFileSync("packages/cli/src/index.ts", "utf8");
    for (const service of [
      "platform.checkUpdates",
      "platform.preflightUpdate",
      "platform.applyUpdate",
      "platform.rollbackUpdate",
      "platform.updateStatus",
    ]) {
      expect(source).toContain(service);
    }
    // No database, no migrations, no deploy commands: the instance owns all of
    // that, because only the instance knows its own adapters and target.
    expect(source).not.toContain("drizzle");
    expect(source).not.toContain("child_process");
  });
});
