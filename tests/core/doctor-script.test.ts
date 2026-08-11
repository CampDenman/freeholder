// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { totpCode } from "../../scripts/doctor.mjs";

describe("the doctor client", () => {
  it("uses the standard six-digit TOTP profile", () => {
    // RFC 6238's shared SHA-1 secret and first published time vector, truncated
    // to the six digits used by ordinary authenticator applications.
    expect(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
  });

  it("rejects malformed base32 instead of generating the wrong code", () => {
    expect(() => totpCode("not+a+totp+secret", 59_000)).toThrow(/base32/i);
  });
});
