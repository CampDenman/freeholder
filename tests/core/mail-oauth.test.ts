// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Delegated sender consent, one-time state and durable refresh evidence.
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { connectedAccounts, connectionCapabilities } from "@/core/connections/schema";
import { decryptSecret, encryptSecret } from "@/core/connections/crypto";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { mailOauthStates, mailSenders } from "@/core/mail/schema";
import {
  beginMailOAuth,
  completeMailOAuth,
  oauthAccessToken,
} from "@/core/mail/oauth";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const SECOND = {
  kind: "user" as const,
  userId: "00000000-0000-4000-8000-000000000099",
  role: "staff",
  grants: [{ module: "mail", access: "manage" as const }],
};

const changedEnvironment = new Map<string, string | undefined>();

function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changedEnvironment.has(name)) changedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
}

async function seedUsers(): Promise<void> {
  await db().insert(users).values([
    { id: OWNER.userId, email: "owner@example.test", role: "owner" },
    { id: SECOND.userId, email: "second@example.test", role: "staff" },
  ]);
}

function stateFrom(authorizationUrl: string): string {
  return new URL(authorizationUrl).searchParams.get("state")!;
}

describe.runIf(hasDatabase)("mail OAuth", () => {
  beforeEach(async () => {
    await truncateSpine();
    await seedUsers();
    environment({
      APP_URL: "https://freeholder.example",
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-client-secret",
      MICROSOFT_OAUTH_TENANT: "common",
    });
  });

  afterEach(() => {
    for (const [name, value] of changedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    changedEnvironment.clear();
    resetEnvForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates a short-lived hashed state and least-privilege Google authorization", async () => {
    const result = await beginMailOAuth.call(
      { provider: "google", returnTo: "/admin/settings?section=mail" },
      OWNER,
    );
    const url = new URL(result.authorizationUrl);
    const bearerState = stateFrom(result.authorizationUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://freeholder.example/api/mail/oauth/google/callback",
    );
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining([
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.send",
      ]),
    );
    expect(url.searchParams.get("scope")).not.toContain("gmail.read");
    expect(url.searchParams.get("access_type")).toBe("offline");

    const [stored] = await db().select().from(mailOauthStates);
    expect(stored).toMatchObject({
      tokenHash: createHash("sha256").update(bearerState).digest("hex"),
      userId: OWNER.userId,
      provider: "google",
      returnTo: "/admin/settings?section=mail",
      consumedAt: null,
    });
    expect(stored?.tokenHash).not.toBe(bearerState);
    expect(stored!.expiresAt.getTime() - stored!.createdAt.getTime()).toBeLessThanOrEqual(
      10 * 60 * 1000 + 1000,
    );
  });

  it("requires a person, mail permission, fresh step-up when present, and an admin return", async () => {
    expect(
      (await failure(beginMailOAuth.call({ provider: "google" }, ANONYMOUS))).code,
    ).toBe("permission");
    expect(
      (
        await failure(
          beginMailOAuth.call(
            { provider: "google" },
            { ...SECOND, grants: [] },
          ),
        )
      ).code,
    ).toBe("permission");
    expect(
      (
        await failure(
          beginMailOAuth.call(
            { provider: "google" },
            {
              ...SECOND,
              security: {
                twoFactorRequired: true,
                twoFactorEnrolled: true,
                twoFactorVerified: true,
                stepUpValid: false,
              },
            },
          ),
        )
      ).code,
    ).toBe("step_up_required");
    expect(
      (
        await failure(
          beginMailOAuth.call(
            { provider: "google", returnTo: "https://attacker.example" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("validation");
  });

  it("claims state before provider exchange so failures and replays cannot reuse it", async () => {
    const begun = await beginMailOAuth.call({ provider: "google" }, OWNER);
    const state = stateFrom(begun.authorizationUrl);
    const fetcher = vi.fn(async () =>
      new Response('{"error":"invalid_grant","private":"provider detail"}', {
        status: 400,
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      completeMailOAuth.call(
        { provider: "google", state, code: "one-use-code" },
        OWNER,
      ),
    ).rejects.toThrow("HTTP 400");
    const [stored] = await db()
      .select()
      .from(mailOauthStates)
      .where(eq(mailOauthStates.tokenHash, createHash("sha256").update(state).digest("hex")));
    expect(stored?.consumedAt).toBeInstanceOf(Date);

    expect(
      (
        await failure(
          completeMailOAuth.call(
            { provider: "google", state, code: "second-code" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("permission");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("binds a state to the initiating user and provider", async () => {
    const begun = await beginMailOAuth.call({ provider: "google" }, OWNER);
    const state = stateFrom(begun.authorizationUrl);
    expect(
      (
        await failure(
          completeMailOAuth.call(
            { provider: "google", state, code: "code" },
            SECOND,
          ),
        )
      ).code,
    ).toBe("permission");
    expect(
      (
        await failure(
          completeMailOAuth.call(
            { provider: "microsoft", state, code: "code" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("permission");
  });

  it("connects a Gmail sender, stores encrypted tokens, and makes the first one default", async () => {
    const begun = await beginMailOAuth.call(
      { provider: "google", returnTo: "/admin/settings?section=mail" },
      OWNER,
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "private-access-token",
          refresh_token: "private-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          sub: "google-account-id",
          email: "OWNER@Example.Test",
          name: "Owner",
        }),
      );
    vi.stubGlobal("fetch", fetcher);

    const completed = await completeMailOAuth.call(
      {
        provider: "google",
        state: stateFrom(begun.authorizationUrl),
        code: "authorization-code",
      },
      OWNER,
    );
    expect(completed).toMatchObject({
      email: "owner@example.test",
      returnTo: "/admin/settings?section=mail",
    });
    const [account] = await db().select().from(connectedAccounts);
    expect(account).toMatchObject({
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "google-account-id",
      email: "owner@example.test",
      status: "active",
    });
    expect(account?.credentials).not.toContain("private-access-token");
    expect(
      JSON.parse(decryptSecret(account!.credentials!, account!.id)),
    ).toMatchObject({
      accessToken: "private-access-token",
      refreshToken: "private-refresh-token",
    });
    expect(await db().select().from(connectionCapabilities)).toMatchObject([
      { capability: "mail_send", enabled: true },
    ]);
    expect(await db().select().from(mailSenders)).toMatchObject([
      {
        provider: "gmail",
        email: "owner@example.test",
        verificationStatus: "verified",
        status: "active",
        isDefault: true,
      },
    ]);
  });

  it("does not let a provider account move between Freeholder users", async () => {
    const accountId = crypto.randomUUID();
    await db().insert(connectedAccounts).values({
      id: accountId,
      userId: SECOND.userId,
      provider: "google",
      providerAccountId: "shared-provider-id",
      email: "second@example.test",
    });
    const begun = await beginMailOAuth.call({ provider: "google" }, OWNER);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            access_token: "new-access",
            refresh_token: "new-refresh",
            scope: "https://www.googleapis.com/auth/gmail.send",
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            sub: "shared-provider-id",
            email: "owner@example.test",
          }),
        ),
    );
    expect(
      (
        await failure(
          completeMailOAuth.call(
            {
              provider: "google",
              state: stateFrom(begun.authorizationUrl),
              code: "authorization-code",
            },
            OWNER,
          ),
        )
      ).code,
    ).toBe("conflict");
    const [account] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, accountId));
    expect(account?.userId).toBe(SECOND.userId);
  });

  it("persists reconnect evidence even when the caller transaction rolls back", async () => {
    const accountId = crypto.randomUUID();
    const credentials = encryptSecret(
      JSON.stringify({
        accessToken: "expired-access",
        refreshToken: "revoked-refresh",
        expiresAt: "2000-01-01T00:00:00.000Z",
        tokenType: "Bearer",
      }),
      accountId,
    );
    await db().insert(connectedAccounts).values({
      id: accountId,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "refresh-account",
      credentials,
      status: "active",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response('{"error":"invalid_grant","private":"revoked detail"}', {
          status: 400,
        }),
      ),
    );

    await expect(
      db().transaction((tx) =>
        oauthAccessToken(tx, { id: accountId, provider: "google" }),
      ),
    ).rejects.toThrow("HTTP 400");
    const [account] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, accountId));
    expect(account?.status).toBe("needs_reconnect");
    expect(account?.lastError).toContain("Reconnect");
    expect(account?.credentials).toBe(credentials);
    expect(account?.lastError).not.toContain("revoked detail");
  });

  it("keeps transient refresh failures active and successfully rotates a refreshed token", async () => {
    const accountId = crypto.randomUUID();
    const expired = encryptSecret(
      JSON.stringify({
        accessToken: "expired-access",
        refreshToken: "refresh-token",
        expiresAt: "2000-01-01T00:00:00.000Z",
        tokenType: "Bearer",
      }),
      accountId,
    );
    await db().insert(connectedAccounts).values({
      id: accountId,
      userId: OWNER.userId,
      provider: "google",
      providerAccountId: "transient-account",
      credentials: expired,
      status: "active",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(
      db().transaction((tx) =>
        oauthAccessToken(tx, { id: accountId, provider: "google" }),
      ),
    ).rejects.toThrow("unreadable response");
    let [account] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, accountId));
    expect(account?.status).toBe("active");
    expect(account?.lastError).toContain("will retry");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "fresh-access",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      ),
    );
    await expect(
      db().transaction(async (tx) => {
        const accessToken = await oauthAccessToken(tx, {
          id: accountId,
          provider: "google",
        });
        expect(accessToken).toBe("fresh-access");
        throw new Error("roll back the caller after provider rotation");
      }),
    ).rejects.toThrow("roll back the caller");
    [account] = await db()
      .select()
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, accountId));
    expect(account).toMatchObject({ status: "active", lastError: null });
    expect(JSON.parse(decryptSecret(account!.credentials!, accountId))).toMatchObject({
      accessToken: "fresh-access",
      refreshToken: "rotated-refresh",
    });
  });
});
