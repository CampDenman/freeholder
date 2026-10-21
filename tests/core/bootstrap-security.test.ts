// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.03/C11.10: deployment ownership and explicit proxy trust.
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireBootstrapSecret } from "@/core/auth/bootstrap";
import { resetEnvForTests } from "@/core/env";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";

afterEach(() => { vi.unstubAllEnvs(); resetEnvForTests(); });

describe("deployment security boundaries", () => {
  it("refuses production setup when the operator has not configured a secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BOOTSTRAP_SECRET", undefined);
    resetEnvForTests();
    expect(() => requireBootstrapSecret()).toThrow(/configure BOOTSTRAP_SECRET/);
  });

  it("requires the exact configured secret in every environment", () => {
    vi.stubEnv("BOOTSTRAP_SECRET", "operator-only-bootstrap-secret-32-characters");
    resetEnvForTests();
    expect(() => requireBootstrapSecret()).toThrow(/missing or incorrect/);
    expect(() => requireBootstrapSecret("attacker")).toThrow(/missing or incorrect/);
    expect(() => requireBootstrapSecret("operator-only-bootstrap-secret-32-characters")).not.toThrow();
  });

  it("does not trust client forwarding headers unless explicitly configured", () => {
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", undefined);
    resetEnvForTests();
    const headers = new Headers({ "cf-connecting-ip": "192.0.2.1", "x-real-ip": "192.0.2.2" });
    expect(requestMetadataFromHeaders(headers).trustedIp).toBeUndefined();
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-real-ip");
    resetEnvForTests();
    expect(requestMetadataFromHeaders(headers).trustedIp).toBe("192.0.2.2");
    headers.set("x-real-ip", "not-an-address");
    expect(requestMetadataFromHeaders(headers).trustedIp).toBeUndefined();
  });
});
