// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The HTTP edge: the one place identity enters from outside, and the one place
// a ServiceError becomes a status code. Before this existed the whole platform
// was reachable only from tests.
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import {
  clearedSessionCookie,
  readCookie,
  readSessionToken,
  sessionCookie,
} from "@/core/http/cookies";
import { errorResponse } from "@/core/http/respond";
import { serviceRoute } from "@/core/http/route";
import { defineService, ServiceError, type Actor } from "@/core/service";

const ANON: Actor = { kind: "anonymous" };
const CUSTOMER: Actor = {
  kind: "user",
  userId: "u1",
  role: "customer",
  grants: [],
};

const request = (
  url = "https://example.test/api/thing",
  init: RequestInit = {},
) => new Request(url, init);

describe("cookies", () => {
  it("reads one cookie out of a crowded header", () => {
    const req = request("https://example.test/", {
      headers: {
        cookie: `theme=dark; ${SESSION_COOKIE}=abc123; locale=fr-CA`,
      },
    });
    expect(readSessionToken(req)).toBe("abc123");
    expect(readCookie(req, "locale")).toBe("fr-CA");
    expect(readCookie(req, "absent")).toBeUndefined();
  });

  it("survives odd spacing and url-encoded values", () => {
    const req = request("https://example.test/", {
      headers: { cookie: `  ${SESSION_COOKIE}=a%2Fb%3Dc  ; x=1` },
    });
    expect(readSessionToken(req)).toBe("a/b=c");
  });

  it("returns nothing when there is no cookie header at all", () => {
    expect(readSessionToken(request())).toBeUndefined();
  });

  it("is not confused by a cookie whose name merely ends the same way", () => {
    const req = request("https://example.test/", {
      headers: { cookie: `not_${SESSION_COOKIE}=wrong; ${SESSION_COOKIE}=right` },
    });
    expect(readSessionToken(req)).toBe("right");
  });

  it("makes the session cookie unreadable to scripts", () => {
    const cookie = sessionCookie("tok", new Date("2030-01-01T00:00:00Z"));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Expires=");
  });

  it("clears by expiring immediately, not by dropping the attributes", () => {
    // A clear that omits Path or HttpOnly sets a *different* cookie and leaves
    // the original in place.
    const cookie = clearedSessionCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
  });
});

describe("errorResponse()", () => {
  const codes = [
    ["validation", 400],
    ["not_found", 404],
    ["conflict", 409],
  ] as const;

  for (const [code, status] of codes) {
    it(`maps ${code} to ${status}`, async () => {
      const response = errorResponse(new ServiceError(code, "nope"), CUSTOMER);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: { code, message: "nope" },
      });
    });
  }

  it("answers 401 for an anonymous caller and 403 for a signed-in one", () => {
    // "log in" and "logging in as someone else would not help" are different
    // answers, and a client that cannot tell them apart cannot behave well.
    const error = new ServiceError("permission", "denied");
    expect(errorResponse(error, ANON).status).toBe(401);
    expect(errorResponse(error, CUSTOMER).status).toBe(403);
  });

  it("never leaks the message of an unexpected failure", async () => {
    const credential = ["hunter", "2"].join("");
    const database = new URL("postgres://db:5432/live");
    database.username = "fixture-user";
    database.password = credential;
    const leaky = new Error(
      `connect ECONNREFUSED ${database.href}`,
    );
    const response = errorResponse(leaky, CUSTOMER);
    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain(credential);
    expect(body).not.toContain("postgres://");
    expect(body).toContain("Something went wrong");
  });
});

describe("serviceRoute()", () => {
  let seen: unknown;

  const echo = defineService({
    name: "http.echo",
    summary: "Echoes validated input back.",
    kind: "query",
    permission: "public",
    input: z.object({ name: z.string().min(1), count: z.coerce.number().int() }),
    handler: async (input) => {
      seen = input;
      return { echoed: input };
    },
  });

  const guarded = defineService({
    name: "http.guarded",
    summary: "Staff only.",
    kind: "query",
    permission: "scoped",
    input: z.object({}),
    handler: async () => ({ ok: true }),
  });

  beforeEach(() => {
    seen = undefined;
  });

  it("reads a JSON body on POST", async () => {
    const response = await serviceRoute(echo)(
      request("https://example.test/api/echo", {
        method: "POST",
        body: JSON.stringify({ name: "Ada", count: 2 }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      echoed: { name: "Ada", count: 2 },
    });
  });

  it("reads the query string on GET", async () => {
    const response = await serviceRoute(echo)(
      request("https://example.test/api/echo?name=Grace&count=7"),
    );
    expect(await response.json()).toEqual({
      echoed: { name: "Grace", count: 7 },
    });
  });

  it("turns a malformed body into the service's own validation error", async () => {
    const response = await serviceRoute(echo)(
      request("https://example.test/api/echo", {
        method: "POST",
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation");
    expect(seen).toBeUndefined();
  });

  it("refuses an anonymous caller with 401, without running the handler", async () => {
    const response = await serviceRoute(guarded)(request());
    expect(response.status).toBe(401);
  });

  it("lets `present` move a value out of the body and into a header", async () => {
    // This is the mechanism that keeps session tokens out of response bodies.
    const handler = serviceRoute(echo, {
      present: (result) => ({
        status: 201,
        body: { received: true },
        headers: { "x-echoed-name": (result.echoed as { name: string }).name },
      }),
    });
    const response = await handler(
      request("https://example.test/api/echo?name=Hopper&count=1"),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-echoed-name")).toBe("Hopper");
    expect(await response.json()).toEqual({ received: true });
  });

  it("lets `readInput` take a value the body must not be trusted for", async () => {
    const handler = serviceRoute(echo, {
      readInput: (req) => ({
        name: readCookie(req, "who") ?? "",
        count: 1,
      }),
    });
    const response = await handler(
      request("https://example.test/api/echo", {
        method: "POST",
        headers: { cookie: "who=FromCookie" },
        body: JSON.stringify({ name: "FromBody", count: 99 }),
      }),
    );
    expect(await response.json()).toEqual({
      echoed: { name: "FromCookie", count: 1 },
    });
  });

  it("answers JSON with a charset, so clients never have to guess", async () => {
    const response = await serviceRoute(echo)(
      request("https://example.test/api/echo?name=x&count=1"),
    );
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
  });
});
