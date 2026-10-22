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

  function trustedIpWith(
    header: string,
    value: string,
    hops?: string,
  ): string | undefined {
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", header);
    vi.stubEnv("TRUSTED_PROXY_HOPS", hops);
    resetEnvForTests();
    return requestMetadataFromHeaders(new Headers({ [header]: value })).trustedIp;
  }

  it("reads DigitalOcean App Platform's client header whole", () => {
    expect(trustedIpWith("do-connecting-ip", "198.51.100.7")).toBe("198.51.100.7");
    expect(trustedIpWith("do-connecting-ip", "2001:DB8::7")).toBe("2001:db8::7");
    expect(trustedIpWith("do-connecting-ip", "198.51.100.7 junk")).toBeUndefined();
  });

  it("takes an appended X-Forwarded-For from the right, ignoring what the visitor wrote", () => {
    // The visitor sent "1.2.3.4"; the edge appended the address it saw.
    expect(trustedIpWith("x-forwarded-for", "1.2.3.4, 198.51.100.9")).toBe("198.51.100.9");
    // Changing the forged part changes nothing.
    expect(trustedIpWith("x-forwarded-for", "9.9.9.9, 8.8.8.8, 198.51.100.9")).toBe(
      "198.51.100.9",
    );
    // Two appending proxies: the client is the second entry from the right.
    expect(trustedIpWith("x-forwarded-for", "1.2.3.4, 198.51.100.9, 10.0.0.2", "2")).toBe(
      "198.51.100.9",
    );
    // IPv6, bracketed with a port or bare.
    expect(trustedIpWith("x-forwarded-for", "1.2.3.4, [2001:db8::9]:443")).toBe("2001:db8::9");
    expect(trustedIpWith("x-forwarded-for", "2001:DB8::A")).toBe("2001:db8::a");
    expect(trustedIpWith("x-forwarded-for", "198.51.100.9:51000")).toBe("198.51.100.9");
  });

  it("gives no address rather than a neighbour when X-Forwarded-For is short or malformed", () => {
    // Fewer entries than proxies: the visitor may have written all of them.
    expect(trustedIpWith("x-forwarded-for", "198.51.100.9", "2")).toBeUndefined();
    // A malformed entry at the trusted position is not skipped over.
    expect(trustedIpWith("x-forwarded-for", "198.51.100.9, unknown")).toBeUndefined();
    expect(trustedIpWith("x-forwarded-for", "198.51.100.9, ")).toBeUndefined();
    expect(trustedIpWith("x-forwarded-for", "198.51.100.9, 999.1.1.1")).toBeUndefined();
    expect(trustedIpWith("x-forwarded-for", "")).toBeUndefined();
  });

  it("refuses a proxy-hop count it cannot use", () => {
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-forwarded-for");
    for (const hops of ["0", "-1", "1.5", "eleven"]) {
      vi.stubEnv("TRUSTED_PROXY_HOPS", hops);
      resetEnvForTests();
      expect(() => requestMetadataFromHeaders(new Headers())).toThrow();
    }
  });
});
