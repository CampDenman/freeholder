// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/core/auth/passwords";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(
      verifyPassword("correct horse battery staple", stored),
    ).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("Correct horse battery staple", stored))
      .resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("salts, so identical passwords hash differently", async () => {
    const a = await hashPassword("same password twice");
    const b = await hashPassword("same password twice");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same password twice", a)).resolves.toBe(true);
    await expect(verifyPassword("same password twice", b)).resolves.toBe(true);
  });

  it("stores its own parameters, so they can be raised later", async () => {
    const stored = await hashPassword("whatever");
    const [scheme, n, r, p, salt, key] = stored.split(":");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
    expect(salt).toBeTruthy();
    expect(key).toBeTruthy();
  });

  it("never treats a malformed stored value as a match", async () => {
    for (const junk of [
      "",
      "not-a-hash",
      "scrypt:16384:8:1:onlyfiveparts",
      "bcrypt:16384:8:1:c2FsdA==:a2V5",
      "scrypt::::::",
      // Corrupted records must answer "no", not throw.
      "scrypt:16384:8:1::",
      "scrypt:16384:8:1::a2V5",
      "scrypt:abc:8:1:c2FsdA==:a2V5",
      "scrypt:0:8:1:c2FsdA==:a2V5",
      "scrypt:16384:0:1:c2FsdA==:a2V5",
    ]) {
      await expect(verifyPassword("anything", junk)).resolves.toBe(false);
    }
  });
});
