// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The auth routes end to end, through the real handlers against a real
// database: first boot, sign in, carry the cookie, sign out. This is the first
// test in the project that exercises the platform the way a browser will.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as loginRoute } from "../../app/api/auth/login/route";
import { POST as logoutRoute } from "../../app/api/auth/logout/route";
import { GET as sessionRoute } from "../../app/api/auth/session/route";
import { POST as registerOwnerRoute } from "../../app/api/setup/owner/route";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { CSRF_COOKIE, CSRF_HEADER } from "@/core/http/csrf";
import { closeDb, hasDatabase, truncateSpine } from "../helpers/spine";

const PASSWORD = "a-sufficiently-long-owner-password";

const post = (
  url: string,
  body: unknown,
  auth?: { cookie: string; csrf?: string },
) =>
  new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { cookie: auth.cookie } : {}),
      ...(auth?.csrf ? { [CSRF_HEADER]: auth.csrf } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (url: string, cookie?: string) =>
  new Request(url, { headers: cookie ? { cookie } : {} });

/**
 * What a browser would hold after this response, and what it would echo back.
 * Sign-in sets two cookies, so this reads them all rather than the first.
 */
function clientState(response: Response): { cookie: string; csrf: string } {
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) throw new Error("expected a Set-Cookie header");
  const pairs = setCookies.map((c) => c.split(";")[0]!);
  const csrfPair = pairs.find((p) => p.startsWith(`${CSRF_COOKIE}=`));
  return {
    cookie: pairs.join("; "),
    csrf: csrfPair ? decodeURIComponent(csrfPair.slice(CSRF_COOKIE.length + 1)) : "",
  };
}

/** Just the session token value, for assertions about where it must not be. */
function sessionTokenFrom(response: Response): string {
  const pair = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`));
  if (!pair) throw new Error("expected a session cookie");
  return decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1));
}

describe.runIf(hasDatabase)("the auth routes", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  const registerOwner = () =>
    registerOwnerRoute(
      post("https://example.test/api/setup/owner", {
        email: "owner@example.test",
        password: PASSWORD,
      }),
    );

  it("creates the owner on first boot and signs them straight in", async () => {
    const response = await registerOwner();
    expect(response.status).toBe(201);

    const body = (await response.json()) as { userId: string };
    expect(body.userId).toBeTruthy();

    const { cookie } = clientState(response);
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain(`${CSRF_COOKIE}=`);

    const session = await sessionRoute(
      get("https://example.test/api/auth/session", cookie),
    );
    const who = (await session.json()) as {
      user: { email: string; role: string } | null;
    };
    expect(who.user?.email).toBe("owner@example.test");
    expect(who.user?.role).toBe("owner");
  });

  it("never puts the session token in a response body", async () => {
    // The token belongs in an HttpOnly cookie and nowhere a script can read.
    const created = await registerOwner();
    const token = sessionTokenFrom(created);
    expect(token.length).toBeGreaterThan(20);

    const createdBody = JSON.stringify(await created.json());
    expect(createdBody).not.toContain(token);
    expect(createdBody).not.toContain("token");

    const loggedIn = await loginRoute(
      post("https://example.test/api/auth/login", {
        email: "owner@example.test",
        password: PASSWORD,
      }),
    );
    const loginBody = JSON.stringify(await loggedIn.json());
    expect(loginBody).not.toContain(sessionTokenFrom(loggedIn));
    expect(loginBody).not.toContain("expiresAt");
  });

  it("refuses a second owner with 409", async () => {
    await registerOwner();
    const again = await registerOwnerRoute(
      post("https://example.test/api/setup/owner", {
        email: "someone-else@example.test",
        password: PASSWORD,
      }),
    );
    expect(again.status).toBe(409);
    const body = (await again.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/already has an owner/);
  });

  it("rejects a weak password with 400 before creating anything", async () => {
    const response = await registerOwnerRoute(
      post("https://example.test/api/setup/owner", {
        email: "owner@example.test",
        password: "short",
      }),
    );
    expect(response.status).toBe(400);
    const session = await sessionRoute(get("https://example.test/api/auth/session"));
    expect((await session.json()) as unknown).toEqual({ user: null });
  });

  it("answers a wrong password with 401 and sets no cookie", async () => {
    await registerOwner();
    const response = await loginRoute(
      post("https://example.test/api/auth/login", {
        email: "owner@example.test",
        password: "definitely-not-the-password",
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("reports nobody for a request with no cookie", async () => {
    await registerOwner();
    const response = await sessionRoute(
      get("https://example.test/api/auth/session"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({ user: null });
  });

  it("clears a cookie that names a session which no longer exists", async () => {
    const created = await registerOwner();
    const client = clientState(created);
    await logoutRoute(
      post("https://example.test/api/auth/logout", {}, client),
    );
    const cookie = client.cookie;

    const response = await sessionRoute(
      get("https://example.test/api/auth/session", cookie),
    );
    expect((await response.json()) as unknown).toEqual({ user: null });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("signs out the caller's own session and nobody else's", async () => {
    const owner = await registerOwner();
    const ownerClient = clientState(owner);
    const ownerCookie = ownerClient.cookie;

    // A second session for the same user, as a second browser would have.
    const second = await loginRoute(
      post("https://example.test/api/auth/login", {
        email: "owner@example.test",
        password: PASSWORD,
      }),
    );
    const secondClient = clientState(second);
    const secondCookie = secondClient.cookie;
    expect(secondCookie).not.toBe(ownerCookie);

    const loggedOut = await logoutRoute(
      post("https://example.test/api/auth/logout", {}, secondClient),
    );
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get("set-cookie")).toContain("Max-Age=0");

    // The session that logged out is gone; the other one still works.
    const dead = await sessionRoute(
      get("https://example.test/api/auth/session", secondCookie),
    );
    expect((await dead.json()) as unknown).toEqual({ user: null });

    const alive = await sessionRoute(
      get("https://example.test/api/auth/session", ownerCookie),
    );
    const who = (await alive.json()) as { user: { role: string } | null };
    expect(who.user?.role).toBe("owner");
  });

  it("refuses a cookie-authenticated write carrying no CSRF token", async () => {
    // The forged request: another site causes the browser to POST here, and
    // the session cookie rides along automatically. The attacker cannot read
    // the CSRF cookie to copy it into a header, so this must not go through.
    const owner = await registerOwner();
    const { cookie } = clientState(owner);

    const forged = await logoutRoute(
      post("https://example.test/api/auth/logout", {}, { cookie }),
    );
    expect(forged.status).toBe(403);

    // And the session it tried to end is still alive.
    const alive = await sessionRoute(
      get("https://example.test/api/auth/session", cookie),
    );
    const who = (await alive.json()) as { user: { role: string } | null };
    expect(who.user?.role).toBe("owner");
  });

  it("refuses a CSRF token that does not match the cookie", async () => {
    const owner = await registerOwner();
    const { cookie } = clientState(owner);
    const forged = await logoutRoute(
      post(
        "https://example.test/api/auth/logout",
        {},
        { cookie, csrf: "a-token-the-attacker-guessed" },
      ),
    );
    expect(forged.status).toBe(403);
  });

  it("needs no CSRF token before sign-in, or login could never happen", async () => {
    await registerOwner();
    const response = await loginRoute(
      post("https://example.test/api/auth/login", {
        email: "owner@example.test",
        password: PASSWORD,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("ignores a session token supplied in the body instead of the cookie", async () => {
    // The forged path: naming a session you do not hold must do nothing.
    const owner = await registerOwner();
    const ownerCookie = clientState(owner).cookie;
    const stolenToken = sessionTokenFrom(owner);

    await logoutRoute(
      post("https://example.test/api/auth/logout", { token: stolenToken }),
    );

    const alive = await sessionRoute(
      get("https://example.test/api/auth/session", ownerCookie),
    );
    const who = (await alive.json()) as { user: { role: string } | null };
    expect(who.user?.role).toBe("owner");
  });
});
