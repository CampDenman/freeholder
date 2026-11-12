// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.34/C11.10: a provider identity is keyed by independent private material.
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/core/env";
import { leadCredentialFingerprint, leadCredentialFingerprints } from "@/modules/forms/lead-notice";

const names = ["CREDENTIAL_KEY", "CREDENTIAL_KEY_PREVIOUS", "SESSION_SECRET"] as const;
const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
afterEach(() => {
  for (const name of names) {
    if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name];
  }
  resetEnvForTests();
});

describe("private original lead credential binding", () => {
  it("changes with independent private material and retains only configured key candidates", () => {
    const originalKey = "0011223344556677".repeat(4), replacementKey = "8899aabbccddeeff".repeat(4);
    process.env.CREDENTIAL_KEY = originalKey;
    delete process.env.CREDENTIAL_KEY_PREVIOUS;
    delete process.env.SESSION_SECRET;
    resetEnvForTests();
    const original = leadCredentialFingerprint("https://original.example.test", "fictional-original-provider-key");
    process.env.CREDENTIAL_KEY = replacementKey;
    process.env.CREDENTIAL_KEY_PREVIOUS = originalKey;
    resetEnvForTests();
    expect(leadCredentialFingerprint("https://original.example.test", "fictional-original-provider-key")).not.toBe(original);
    expect(leadCredentialFingerprints("https://original.example.test", "fictional-original-provider-key")).toContain(original);
    expect(leadCredentialFingerprints("https://original.example.test", "fictional-replacement-provider-key")).not.toContain(original);
    delete process.env.CREDENTIAL_KEY_PREVIOUS;
    resetEnvForTests();
    expect(leadCredentialFingerprints("https://original.example.test", "fictional-original-provider-key")).not.toContain(original);
  });
  it("has no embedded or unkeyed fallback when every configured private key is missing", () => {
    for (const name of names) delete process.env[name];
    resetEnvForTests();
    expect(() => leadCredentialFingerprint("https://original.example.test", "fictional-original-provider-key")).toThrow("original private configuration");
  });
});
