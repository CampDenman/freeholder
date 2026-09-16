// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Password reset (MASTER.md §9, §13 step 1) and the mail adapter (§12).
//
// A reset flow is a way in. Every test here is about one of the three
// properties that keep it from being an easy one: the token is useless at
// rest, it is worth one use for one hour, and asking for a reset tells the
// asker nothing about who has an account.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { passwordResets, sessions, users } from "@/core/auth/schema";
import { auditLog } from "@/core/events/schema";
import { mailSuppressions } from "@/core/mail/schema";
import { login, registerOwner } from "@/core/auth/service";
import { requestPasswordReset, resetPassword } from "@/core/auth/reset";
import { createConsoleMail } from "@/adapters/mail/console";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";
import { flushQueuedMail } from "../helpers/mail";

const EMAIL = "owner@example.test";
const OLD = "the-original-owner-password";
const NEW = "a-replacement-that-is-long-enough";

/** The link the mailer was handed, which is the only place a token exists. */
function tokenFrom(logged: string[]): string {
  const match = /\/reset\?token=([^\s]+)/.exec(logged.join("\n"));
  if (!match) throw new Error(`no reset link in:\n${logged.join("\n")}`);
  return decodeURIComponent(match[1]!);
}

describe.runIf(hasDatabase)("asking for a reset", () => {
  let logged: string[] = [];

  beforeEach(async () => {
    await truncateSpine();
    await registerOwner.call({ email: EMAIL, password: OLD }, ANONYMOUS);
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeDb();
  });

  it("stores the token hashed, never in the clear", async () => {
    // A database leak must not hand somebody a working reset link for every
    // account on the instance.
    await requestPasswordReset.call({ email: EMAIL }, ANONYMOUS);
    await flushQueuedMail();
    const token = tokenFrom(logged);

    const [row] = await db().select().from(passwordResets);
    expect(row?.tokenHash).toBeTruthy();
    expect(row?.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("answers the same for an address with no account", async () => {
    // Otherwise the form is an account-enumeration oracle, and the person who
    // benefits from the honesty is never the one who typed their own address.
    const known = await requestPasswordReset.call({ email: EMAIL }, ANONYMOUS);
    const unknown = await requestPasswordReset.call(
      { email: "nobody@example.test" },
      ANONYMOUS,
    );
    expect(unknown).toEqual(known);
    // And no row was created for somebody who does not exist.
    expect(await db().select().from(passwordResets)).toHaveLength(1);
  });

  it("does not reveal a known account when delivery is suppressed", async () => {
    await db().insert(mailSuppressions).values({
      email: EMAIL,
      reason: "manual",
      provider: "manual",
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const known = await requestPasswordReset.call({ email: EMAIL }, ANONYMOUS);
    const unknown = await requestPasswordReset.call(
      { email: "nobody@example.test" },
      ANONYMOUS,
    );
    expect(known).toEqual(unknown);
    expect(await db().select().from(passwordResets)).toHaveLength(0);
    expect(errorLog).toHaveBeenCalledWith("password-reset mail delivery failed");
  });

  it("normalises the address the way sign-in does", async () => {
    await requestPasswordReset.call({ email: "  OWNER@Example.TEST " }, ANONYMOUS);
    expect(await db().select().from(passwordResets)).toHaveLength(1);
  });

  it("invalidates the previous link when a new one is asked for", async () => {
    // Somebody pressing "send it again" expects the newest email to work, and
    // leaving the older links live widens the window for nothing.
    await requestPasswordReset.call({ email: EMAIL }, ANONYMOUS);
    await flushQueuedMail();
    const first = tokenFrom(logged);
    logged = [];
    await requestPasswordReset.call({ email: EMAIL }, ANONYMOUS);
    await flushQueuedMail();
    const second = tokenFrom(logged);

    const stale = await failure(
      resetPassword.call({ token: first, newPassword: NEW }, ANONYMOUS),
    );
    expect(stale.code).toBe("permission");
    await expect(
      resetPassword.call({ token: second, newPassword: NEW }, ANONYMOUS),
    ).resolves.toMatchObject({ ok: true });
  });

  it("never writes the token to the audit trail", async () => {
    await requestPasswordReset.call({ email: EMAIL }, ANONYMOUS);
    await flushQueuedMail();
    const token = tokenFrom(logged);
    const rows = await db().select().from(auditLog);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe.runIf(hasDatabase)("using a reset link", () => {
  let logged: string[] = [];
  const requestToken = async (): Promise<string> => {
    logged = [];
    await requestPasswordReset.call({ email: EMAIL }, ANONYMOUS);
    await flushQueuedMail();
    return tokenFrom(logged);
  };

  beforeEach(async () => {
    await truncateSpine();
    await registerOwner.call({ email: EMAIL, password: OLD }, ANONYMOUS);
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  it("sets the password and retires the link", async () => {
    const token = await requestToken();
    await expect(
      resetPassword.call({ token, newPassword: NEW }, ANONYMOUS),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      login.call({ email: EMAIL, password: NEW }, ANONYMOUS),
    ).resolves.toMatchObject({ role: "owner" });

    // Worth exactly one use.
    const reused = await failure(
      resetPassword.call({ token, newPassword: "yet-another-password" }, ANONYMOUS),
    );
    expect(reused.code).toBe("permission");
  });

  it("signs out every session, including the attacker's", async () => {
    // Unlike a voluntary change, a reset keeps nothing: the person doing it is
    // about to sign in with the password they just chose, and whoever they are
    // evicting must not survive it.
    await login.call({ email: EMAIL, password: OLD }, ANONYMOUS);
    await login.call({ email: EMAIL, password: OLD }, ANONYMOUS);
    expect((await db().select().from(sessions)).length).toBeGreaterThanOrEqual(2);

    const token = await requestToken();
    const result = await resetPassword.call(
      { token, newPassword: NEW },
      ANONYMOUS,
    );
    expect(result.sessionsRevoked).toBeGreaterThanOrEqual(2);
    expect(await db().select().from(sessions)).toHaveLength(0);
  });

  it("refuses an expired link", async () => {
    const token = await requestToken();
    await db()
      .update(passwordResets)
      .set({ expiresAt: sql`now() - interval '1 minute'` });

    const error = await failure(
      resetPassword.call({ token, newPassword: NEW }, ANONYMOUS),
    );
    expect(error.code).toBe("permission");
    // And the old password still works, because nothing changed.
    await expect(
      login.call({ email: EMAIL, password: OLD }, ANONYMOUS),
    ).resolves.toBeDefined();
  });

  it("says the same thing however the link is wrong", async () => {
    // Expired, spent, invented — one message. Distinguishing them tells
    // somebody probing which of their guesses was closest.
    const invented = await failure(
      resetPassword.call(
        { token: "not-a-real-token-at-all", newPassword: NEW },
        ANONYMOUS,
      ),
    );
    const token = await requestToken();
    await resetPassword.call({ token, newPassword: NEW }, ANONYMOUS);
    const spent = await failure(
      resetPassword.call({ token, newPassword: NEW }, ANONYMOUS),
    );
    expect(invented.message).toBe(spent.message);
  });

  it("refuses a password too short to be worth setting", async () => {
    const token = await requestToken();
    const error = await failure(
      resetPassword.call({ token, newPassword: "short" }, ANONYMOUS),
    );
    expect(error.code).toBe("validation");
    // The link survives a rejected attempt: the person typed a bad password,
    // not a bad link, and burning it would make them start over.
    const [row] = await db().select().from(passwordResets);
    expect(row?.usedAt).toBeNull();
  });

  it("stores a hash of the new password, not the password", async () => {
    const token = await requestToken();
    await resetPassword.call({ token, newPassword: NEW }, ANONYMOUS);
    const [user] = await db().select().from(users).where(eq(users.email, EMAIL));
    expect(user?.passwordHash).toMatch(/^scrypt:/);
    expect(user?.passwordHash).not.toContain(NEW);
  });
});

describe("the console mailer", () => {
  it("is honest that it does not deliver", () => {
    // The distinction the reset screen reads: a password reset that
    // "succeeds" into a log file is worse than one that refuses, because the
    // person waiting for the email has no way to tell.
    const adapter = createConsoleMail();
    expect(adapter.delivers).toBe(false);
    expect(adapter.id).toBe("console");
  });

  it("prints the whole message, so a developer can follow the link", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.map(String).join(" "));
    });
    await createConsoleMail().send({
      to: "someone@example.test",
      subject: "A subject",
      text: "The body, with https://example.test/reset?token=abc in it.",
    });
    spy.mockRestore();
    const printed = lines.join("\n");
    expect(printed).toContain("someone@example.test");
    expect(printed).toContain("A subject");
    expect(printed).toContain("token=abc");
  });
});
