// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Connecting a calendar (C4.11, MASTER.md §41): incremental scopes, several
// accounts per provider, and read as the default.
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { connectedAccounts, connectionCapabilities } from "@/core/connections/schema";
import { decryptSecret } from "@/core/connections/crypto";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { mailOauthStates } from "@/core/mail/schema";
import {
  beginCalendarOAuth,
  completeCalendarOAuth,
} from "@/core/connections/calendar-oauth";
import { completeMailOAuth, beginMailOAuth } from "@/core/mail/oauth";
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
  grants: [{ module: "connections", access: "manage" as const }],
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

function stateFrom(authorizationUrl: string): string {
  return new URL(authorizationUrl).searchParams.get("state")!;
}

/** A provider that grants exactly the scopes it is told to. */
function provider(options: {
  scopes: string[];
  accountId?: string;
  email?: string;
}) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: options.scopes.join(" "),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        sub: options.accountId ?? "google-account-1",
        id: options.accountId ?? "google-account-1",
        email: options.email ?? "owner@example.test",
        mail: options.email ?? "owner@example.test",
        name: "Sam Okonjo",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

const CALENDAR_READ = "https://www.googleapis.com/auth/calendar.readonly";
const CALENDAR_WRITE = "https://www.googleapis.com/auth/calendar.events";
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";

describe.runIf(hasDatabase)("calendar OAuth", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: SECOND.userId, email: "second@example.test", role: "staff" },
    ]);
    environment({
      APP_URL: "https://freeholder.example",
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
      MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-client-secret",
      MICROSOFT_OAUTH_TENANT: "common",
    });
  }, 60_000);

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
    await truncateSpine();
    await closeDb();
  });

  it("asks for read access on its own callback, with a hashed one-time state", async () => {
    const begun = await beginCalendarOAuth.call({ provider: "google" }, OWNER);
    const url = new URL(begun.authorizationUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    // Its own route: a code issued for calendars cannot be redeemed by mail,
    // because the redirect URI is part of what the code is bound to.
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://freeholder.example/api/connections/calendar/google/callback",
    );
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain(CALENDAR_READ);
    // Read is the default: editing somebody's calendar is a different ask.
    expect(scopes).not.toContain(CALENDAR_WRITE);
    // Incremental on Google's side, so the person is only asked what is new.
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");

    const [stored] = await db().select().from(mailOauthStates);
    expect(stored).toMatchObject({
      tokenHash: createHash("sha256").update(stateFrom(begun.authorizationUrl)).digest("hex"),
      userId: OWNER.userId,
      provider: "google",
      purpose: "calendar",
      access: "read",
      consumedAt: null,
    });
  });

  it("asks for editing only when editing was chosen", async () => {
    const begun = await beginCalendarOAuth.call(
      { provider: "microsoft", access: "write" },
      OWNER,
    );
    const url = new URL(begun.authorizationUrl);
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain("Calendars.ReadWrite");
    expect(scopes).toContain("offline_access");
  });

  it("stores the account with its credentials encrypted and capabilities recorded", async () => {
    const begun = await beginCalendarOAuth.call({ provider: "google" }, OWNER);
    vi.stubGlobal("fetch", provider({ scopes: [CALENDAR_READ, "openid", "email"] }));
    const done = await completeCalendarOAuth.call(
      { provider: "google", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    expect(done).toMatchObject({ access: "read", email: "owner@example.test" });

    const [account] = await db().select().from(connectedAccounts);
    expect(account?.status).toBe("active");
    expect(account?.scopesGranted).toContain(CALENDAR_READ);
    // The token is never stored in the clear, and is bound to the row's id.
    expect(account?.credentials).not.toContain("refresh-token");
    expect(decryptSecret(account!.credentials!, account!.id)).toContain("refresh-token");

    const capabilities = await db()
      .select()
      .from(connectionCapabilities)
      .where(eq(connectionCapabilities.connectedAccountId, account!.id));
    expect(capabilities.map((row) => row.capability)).toEqual(["calendar_read"]);
  });

  it("adds calendar access to an account already used for mail, keeping both", async () => {
    // The incremental promise, end to end: connecting a calendar on the
    // mailbox that already sends must not cost the business its sending.
    const mail = await beginMailOAuth.call({ provider: "google" }, OWNER);
    vi.stubGlobal("fetch", provider({ scopes: [GMAIL_SEND, "openid", "email"] }));
    await completeMailOAuth.call(
      { provider: "google", state: stateFrom(mail.authorizationUrl), code: "mail-code" },
      OWNER,
    );

    const calendar = await beginCalendarOAuth.call({ provider: "google" }, OWNER);
    vi.stubGlobal(
      "fetch",
      // A real incremental grant returns the union; the platform must keep it
      // even when the provider echoes only the new scope.
      provider({ scopes: [CALENDAR_READ] }),
    );
    await completeCalendarOAuth.call(
      {
        provider: "google",
        state: stateFrom(calendar.authorizationUrl),
        code: "calendar-code",
      },
      OWNER,
    );

    const accounts = await db().select().from(connectedAccounts);
    // One account, not two: the provider account id is the identity.
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.scopesGranted).toEqual(
      expect.arrayContaining([GMAIL_SEND, CALENDAR_READ]),
    );
    const capabilities = await db()
      .select()
      .from(connectionCapabilities)
      .where(eq(connectionCapabilities.connectedAccountId, accounts[0]!.id));
    expect(capabilities.map((row) => row.capability).sort()).toEqual([
      "calendar_read",
      "mail_send",
    ]);
  });

  it("holds several accounts for one provider and one person", async () => {
    for (const account of ["work-calendar", "personal-calendar"]) {
      const begun = await beginCalendarOAuth.call({ provider: "google" }, OWNER);
      vi.stubGlobal(
        "fetch",
        provider({
          scopes: [CALENDAR_READ],
          accountId: account,
          email: `${account}@example.test`,
        }),
      );
      await completeCalendarOAuth.call(
        { provider: "google", state: stateFrom(begun.authorizationUrl), code: account },
        OWNER,
      );
    }
    const accounts = await db().select().from(connectedAccounts);
    expect(accounts).toHaveLength(2);
    expect(accounts.map((row) => row.email).sort()).toEqual([
      "personal-calendar@example.test",
      "work-calendar@example.test",
    ]);
  });

  it("refuses a connection the person did not actually grant", async () => {
    const begun = await beginCalendarOAuth.call({ provider: "google" }, OWNER);
    // The person clicked through but unticked the calendar box.
    vi.stubGlobal("fetch", provider({ scopes: ["openid", "email"] }));
    const refused = await failure(
      completeCalendarOAuth.call(
        { provider: "google", state: stateFrom(begun.authorizationUrl), code: "code" },
        OWNER,
      ),
    );
    expect(refused.code).toBe("permission");
    expect(refused.message).toContain("Calendar access was not granted");
    // A connection that looks successful and cannot do the job is worse than
    // a refusal, so nothing was stored.
    expect(await db().select().from(connectedAccounts)).toHaveLength(0);
  });

  it("spends the state once, binds it to its person, and keeps mail's codes separate", async () => {
    const begun = await beginCalendarOAuth.call({ provider: "google" }, OWNER);
    const state = stateFrom(begun.authorizationUrl);

    // Somebody else's session cannot finish this connection.
    expect(
      (
        await failure(
          completeCalendarOAuth.call({ provider: "google", state, code: "x" }, SECOND),
        )
      ).code,
    ).toBe("permission");
    // Nor can the mail flow redeem a calendar code.
    expect(
      (
        await failure(
          completeMailOAuth.call({ provider: "google", state, code: "x" }, OWNER),
        )
      ).code,
    ).toBe("permission");

    vi.stubGlobal("fetch", provider({ scopes: [CALENDAR_READ] }));
    await completeCalendarOAuth.call({ provider: "google", state, code: "one-use" }, OWNER);
    // And it is spent: the same state cannot be replayed.
    expect(
      (
        await failure(
          completeCalendarOAuth.call({ provider: "google", state, code: "again" }, OWNER),
        )
      ).code,
    ).toBe("permission");
  });

  it("needs a signed-in person and an admin return path", async () => {
    expect(
      (await failure(beginCalendarOAuth.call({ provider: "google" }, ANONYMOUS))).code,
    ).toBe("permission");
    expect(
      (
        await failure(
          beginCalendarOAuth.call(
            { provider: "google", returnTo: "https://elsewhere.example" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("validation");
  });
});
