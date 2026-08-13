// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Session/device controls, suspicious-login notices and retention (C1.04).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { resetMailForTests } from "@/adapters/mail";
import { hashPassword } from "@/core/auth/passwords";
import { loginSecurityEvents, sessions, users } from "@/core/auth/schema";
import { login } from "@/core/auth/service";
import {
  createSession,
  protectSessionMetadata,
} from "@/core/auth/sessions";
import {
  deliverPendingSecurityNotices,
  listSessions,
  recentLoginSecurity,
  revokeOtherSessions,
  revokeSession,
} from "@/core/auth/session-management/service";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { sweepLoginSecurityEvents } from "@/core/jobs/core-jobs";
import {
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const USER_ID = "00000000-0000-4000-8000-000000000092";
const OTHER_ID = "00000000-0000-4000-8000-000000000093";
const PASSWORD = "a-long-session-management-password";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";

describe("request and session metadata", () => {
  it("takes metadata from forwarding headers and bounds long agents", () => {
    const metadata = requestMetadataFromHeaders(
      new Headers({
        "x-forwarded-for": "203.0.113.42, 10.0.0.1",
        "user-agent": `Browser ${"x".repeat(600)}`,
      }),
    );
    expect(metadata.ip).toBe("203.0.113.42");
    expect(metadata.userAgent!.length).toBe(512);
  });

  it("retains only a masked network hint and stable one-way fingerprints", () => {
    const first = protectSessionMetadata({ ip: "203.0.113.42", userAgent: CHROME });
    const update = protectSessionMetadata({
      ip: "203.0.113.99",
      userAgent: CHROME.replace("126.0.0.0", "127.1.2.3"),
    });
    expect(first.ipHint).toBe("203.0.113.xxx");
    expect(JSON.stringify(first)).not.toContain("203.0.113.42");
    expect(first.deviceLabel).toBe("Chrome on Windows");
    expect(first.deviceHash).toBe(update.deviceHash);
    expect(first.networkHash).toBe(update.networkHash);
    const ipv6 = protectSessionMetadata({ ip: "2001:db8:1:2::99", userAgent: CHROME });
    expect(ipv6.ipHint).toBe("2001:db8:1:2::/64");
    expect(JSON.stringify(ipv6)).not.toContain("::99");
  });
});

describe.runIf(hasDatabase)("session and suspicious-login lifecycle", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      {
        id: USER_ID,
        email: "sessions@example.test",
        passwordHash: await hashPassword(PASSWORD),
        role: "owner",
      },
      {
        id: OTHER_ID,
        email: "other-sessions@example.test",
        passwordHash: await hashPassword(PASSWORD),
        role: "customer",
      },
    ]);
  });
  afterAll(closeDb);

  async function signIn(userAgent = CHROME, ip = "203.0.113.42") {
    const result = await login.call(
      { email: "sessions@example.test", password: PASSWORD },
      { kind: "anonymous", request: { userAgent, ip } },
    );
    if (result.twoFactorRequired) throw new Error("test user unexpectedly requires 2FA");
    return result;
  }

  it("lists only the caller's active devices and revokes one or all others", async () => {
    const first = await signIn();
    const second = await signIn(CHROME.replace("126.0.0.0", "127.0.0.0"));
    const outsider = await db().transaction((tx) => createSession(tx, OTHER_ID));
    const actor = await actorFromToken(second.token);

    const visible = await listSessions.call({}, actor);
    expect(visible).toHaveLength(2);
    expect(visible.find((session) => session.current)?.id).toBe(second.sessionId);
    expect(visible[0]?.ipHint).toBe("203.0.113.xxx");
    expect(JSON.stringify(visible)).not.toContain("203.0.113.42");

    expect(
      (await failure(revokeSession.call({ id: outsider.sessionId }, actor))).code,
    ).toBe("not_found");
    await expect(revokeSession.call({ id: first.sessionId }, actor)).resolves.toEqual({
      ok: true,
      current: false,
    });

    const third = await signIn("Mozilla/5.0 (Macintosh) Firefox/128.0", "198.51.100.8");
    const current = await actorFromToken(third.token);
    expect(
      (await failure(revokeOtherSessions.call({}, current))).code,
    ).toBe("step_up_required");
    const elevated = {
      ...current,
      security: {
        twoFactorRequired: true,
        twoFactorEnrolled: true,
        twoFactorVerified: true,
        stepUpValid: true,
      },
    } as typeof current;
    await expect(revokeOtherSessions.call({}, elevated)).resolves.toMatchObject({
      ok: true,
      revoked: 1,
    });
    expect(await listSessions.call({}, current)).toHaveLength(1);
  });

  it("flags a new device, records the notice, and does not require mail for login", async () => {
    await signIn();
    await signIn(CHROME.replace("126.0.0.0", "127.0.0.0"), "203.0.113.99");
    const suspicious = await signIn(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/128.0",
      "198.51.100.8",
    );
    const actor = await actorFromToken(suspicious.token);
    const activity = await recentLoginSecurity.call({ limit: 10 }, actor);
    expect(activity).toHaveLength(3);
    expect(activity[0]).toMatchObject({
      deviceLabel: "Firefox on macOS",
      ipHint: "198.51.100.xxx",
      reason: "new_device",
      noticeStatus: "pending",
    });
    expect(activity[1]?.reason).toBeNull();

    process.env.MAIL_ADAPTER = "console";
    resetEnvForTests();
    resetMailForTests();
    await expect(deliverPendingSecurityNotices()).resolves.toMatchObject({
      sent: 0,
      unavailable: 1,
    });
    const [notice] = await db()
      .select()
      .from(loginSecurityEvents)
      .where(eq(loginSecurityEvents.sessionId, suspicious.sessionId));
    expect(notice).toMatchObject({
      noticeStatus: "unavailable",
      noticeAttempts: 1,
    });
  });

  it("distinguishes a familiar device on a new network", async () => {
    await signIn();
    const moved = await signIn(
      CHROME.replace("126.0.0.0", "127.0.0.0"),
      "198.51.100.8",
    );
    const [event] = await db()
      .select()
      .from(loginSecurityEvents)
      .where(eq(loginSecurityEvents.sessionId, moved.sessionId));
    expect(event).toMatchObject({
      reason: "new_network",
      ipHint: "198.51.100.xxx",
      noticeStatus: "pending",
    });
  });

  it("stores bounded active metadata and no raw IP in retained history", async () => {
    const signedIn = await signIn();
    const [session] = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.id, signedIn.sessionId));
    const [history] = await db()
      .select()
      .from(loginSecurityEvents)
      .where(eq(loginSecurityEvents.sessionId, signedIn.sessionId));
    expect(session?.ip).toBe("203.0.113.xxx");
    expect(session?.lastSeenAt).toBeInstanceOf(Date);
    expect(JSON.stringify(history)).not.toContain("203.0.113.42");
    expect(history?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);

    await db()
      .update(loginSecurityEvents)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(loginSecurityEvents.id, history!.id));
    await expect(sweepLoginSecurityEvents.handler({})).resolves.toEqual({ deleted: 1 });
  });
});

describe("the additive session-management migration", () => {
  it("adds metadata and retained security history without breaking N-1", () => {
    const sql = readFileSync(
      "db/migrations/0020_session-device-management.sql",
      "utf8",
    );
    expect(sql).toContain('CREATE TABLE "login_security_events"');
    expect(sql).toContain('ADD COLUMN "last_seen_at"');
    expect(sql).toContain('UPDATE "sessions"');
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)/);
  });
});
