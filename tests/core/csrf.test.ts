// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  csrfCookie,
  issueCsrfToken,
  requireCsrf,
} from "@/core/http/csrf";
import { ServiceError } from "@/core/service";

const req = (init: {
  method?: string;
  session?: string;
  csrfCookieValue?: string;
  csrfHeader?: string;
}) => {
  const cookies: string[] = [];
  if (init.session) cookies.push(`${SESSION_COOKIE}=${init.session}`);
  if (init.csrfCookieValue) {
    cookies.push(`${CSRF_COOKIE}=${init.csrfCookieValue}`);
  }
  const headers: Record<string, string> = {};
  if (cookies.length) headers.cookie = cookies.join("; ");
  if (init.csrfHeader) headers[CSRF_HEADER] = init.csrfHeader;
  return new Request("https://example.test/api/thing", {
    method: init.method ?? "POST",
    headers,
  });
};

describe("issueCsrfToken()", () => {
  it("is long and never repeats", () => {
    const tokens = new Set(Array.from({ length: 50 }, issueCsrfToken));
    expect(tokens.size).toBe(50);
    expect([...tokens][0]!.length).toBeGreaterThanOrEqual(32);
  });
});

describe("csrfCookie()", () => {
  it("is readable by scripts, unlike the session cookie", () => {
    // The client has to copy this into a header; HttpOnly would make the
    // whole double-submit mechanism impossible.
    const cookie = csrfCookie("tok", new Date("2030-01-01T00:00:00Z"));
    expect(cookie).not.toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });
});

describe("requireCsrf()", () => {
  it("ignores safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(() => requireCsrf(req({ method, session: "s" }))).not.toThrow();
    }
  });

  it("ignores requests with no session — there is nothing to ride", () => {
    // Login and first boot arrive this way and must not need a token.
    expect(() => requireCsrf(req({ method: "POST" }))).not.toThrow();
    expect(() =>
      requireCsrf(req({ method: "POST", csrfHeader: "anything" })),
    ).not.toThrow();
  });

  it("accepts a matching cookie and header", () => {
    const token = issueCsrfToken();
    expect(() =>
      requireCsrf(
        req({ session: "s", csrfCookieValue: token, csrfHeader: token }),
      ),
    ).not.toThrow();
  });

  it("rejects a cookie-authenticated write with no header", () => {
    // This is the forged request: the browser attaches the session cookie
    // automatically, and the attacker cannot read the CSRF cookie to copy it.
    const token = issueCsrfToken();
    const error = (() => {
      try {
        requireCsrf(req({ session: "s", csrfCookieValue: token }));
      } catch (e) {
        return e as ServiceError;
      }
      throw new Error("expected requireCsrf to throw");
    })();
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe("permission");
    expect(error.message).toContain(CSRF_HEADER);
  });

  it("rejects a mismatched token", () => {
    expect(() =>
      requireCsrf(
        req({
          session: "s",
          csrfCookieValue: issueCsrfToken(),
          csrfHeader: issueCsrfToken(),
        }),
      ),
    ).toThrow(ServiceError);
  });

  it("rejects a header with no cookie to compare against", () => {
    expect(() =>
      requireCsrf(req({ session: "s", csrfHeader: issueCsrfToken() })),
    ).toThrow(ServiceError);
  });

  it("rejects empty tokens even when they match each other", () => {
    // Two empty strings are equal; that must not be a valid proof.
    expect(() =>
      requireCsrf(req({ session: "s", csrfCookieValue: "", csrfHeader: "" })),
    ).toThrow(ServiceError);
  });

  it("rejects a prefix of the real token", () => {
    const token = issueCsrfToken();
    expect(() =>
      requireCsrf(
        req({
          session: "s",
          csrfCookieValue: token,
          csrfHeader: token.slice(0, -1),
        }),
      ),
    ).toThrow(ServiceError);
  });

  it("covers every unsafe method, not just POST", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(() =>
        requireCsrf(req({ method, session: "s", csrfCookieValue: "a" })),
      ).toThrow(ServiceError);
    }
  });
});
