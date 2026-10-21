// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The locked-out-owner escape hatch (MASTER.md §9, §13).
//
// `scripts/owner-password.mjs` restates the scrypt parameters instead of
// importing them, because inside the published container the module they live
// in cannot be reached. That is a deliberate duplication, and a deliberate
// duplication with nothing checking it is just a copy waiting to rot — the
// symptom being a password that the script swears it set and the application
// refuses, on the one day somebody is already locked out.
//
// So this runs the real script and hands what it produced to the real verifier.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/core/auth/passwords";

function runScript(password?: string, options: string[] = []): string {
  return execFileSync(
    process.execPath,
    ["scripts/owner-password.mjs", ...(password ? [password] : []), ...options],
    { encoding: "utf8" },
  );
}

/** The hash out of the UPDATE the script prints. */
function hashFrom(output: string): string {
  const match = /password_hash = '([^']+)'/.exec(output);
  if (!match) throw new Error(`no hash in the script's output:\n${output}`);
  return match[1]!;
}

function generatedPassword() {
  const output = runScript();
  const path = /Generated password saved privately to: (.+)/.exec(output)?.[1];
  if (!path) throw new Error("Recovery script did not report a private password file.");
  try {
    const password = readFileSync(path, "utf8").trim();
    const mode = statSync(path).mode & 0o777;
    const directoryMode = statSync(dirname(path)).mode & 0o777;
    return { output, password, mode, directoryMode };
  } finally {
    rmSync(dirname(path), { recursive: true });
  }
}

describe("the owner password script", () => {
  it("produces a hash the application accepts", async () => {
    // The assertion that matters: two implementations of one format, checked
    // against each other rather than trusted.
    const chosen = "a-known-password-for-the-test";
    const output = runScript(chosen);
    expect(await verifyPassword(chosen, hashFrom(output))).toBe(true);
    expect(await verifyPassword("something-else-entirely", hashFrom(output))).toBe(
      false,
    );
  });

  it("writes a hash in the same shape the application writes", async () => {
    const shared = "a-password-long-enough-to-compare";
    const mine = await hashPassword(shared);
    const theirs = hashFrom(runScript(shared));
    // Same algorithm and same cost parameters; the salt and key differ, which
    // is the whole point of a salt.
    expect(theirs.split(":").slice(0, 4)).toEqual(mine.split(":").slice(0, 4));
  });

  it("saves generated passwords privately without exposing them in output", async () => {
    const { output, password, mode, directoryMode } = generatedPassword();
    expect(password).toHaveLength(24);
    expect(output).not.toContain(password);
    expect(mode).toBe(0o600);
    expect(directoryMode).toBe(0o700);
    expect(await verifyPassword(password, hashFrom(output))).toBe(true);
  });

  it("avoids the characters people misread when typing one out", () => {
    // It is read off a terminal and typed by hand exactly once, by somebody
    // already having a bad day.
    expect(generatedPassword().password).not.toMatch(/[l1IO0]/);
  });

  it("never echoes a supplied password into redirected output", () => {
    const chosen = "a-secret-known-only-to-the-operator";
    expect(runScript(chosen)).not.toContain(chosen);
  });

  it("revokes the owner's sessions as well", () => {
    // Somebody resetting the owner's password is precisely somebody who should
    // stop assuming every existing session is theirs.
    expect(runScript("a-long-enough-password")).toContain("delete from sessions");
  });

  it("can deliberately clear every second factor for break-glass recovery", () => {
    const output = runScript("a-long-enough-password", ["--disable-2fa"]);
    expect(output).toContain("delete from totp_factors");
    expect(output).toContain("delete from webauthn_credentials");
    expect(output).toContain("delete from two_factor_recovery_codes");
    expect(output).toMatch(/enrol it again immediately/i);
  });

  it("refuses a password too short to be worth setting", () => {
    expect(() => runScript("short")).toThrow();
  });
});
