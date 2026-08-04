// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
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
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/core/auth/passwords";

function runScript(password?: string): string {
  return execFileSync(
    process.execPath,
    ["scripts/owner-password.mjs", ...(password ? [password] : [])],
    { encoding: "utf8" },
  );
}

/** The hash out of the UPDATE the script prints. */
function hashFrom(output: string): string {
  const match = /password_hash = '([^']+)'/.exec(output);
  if (!match) throw new Error(`no hash in the script's output:\n${output}`);
  return match[1]!;
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

  it("generates a password when given none, and shows it once", async () => {
    const output = runScript();
    const shown = /^ {4}(\S{20,})$/m.exec(output);
    expect(shown).not.toBeNull();
    expect(await verifyPassword(shown![1]!, hashFrom(output))).toBe(true);
  });

  it("avoids the characters people misread when typing one out", () => {
    // It is read off a terminal and typed by hand exactly once, by somebody
    // already having a bad day.
    const shown = /^ {4}(\S{20,})$/m.exec(runScript())![1]!;
    expect(shown).not.toMatch(/[l1IO0]/);
  });

  it("revokes the owner's sessions as well", () => {
    // Somebody resetting the owner's password is precisely somebody who should
    // stop assuming every existing session is theirs.
    expect(runScript("a-long-enough-password")).toContain("delete from sessions");
  });

  it("refuses a password too short to be worth setting", () => {
    expect(() => runScript("short")).toThrow();
  });
});
