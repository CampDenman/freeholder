// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Privileged-session 2FA, replay resistance, recovery and step-up (C1.03).
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { desc } from "drizzle-orm";
import { db } from "@/core/db";
import { loginSecurityEvents, sessions, users } from "@/core/auth/schema";
import { hashPassword } from "@/core/auth/passwords";
import { login } from "@/core/auth/service";
import { createSession } from "@/core/auth/sessions";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import {
  beginTotpEnrollment,
  beginWebAuthnRegistration,
  completeTwoFactorLogin,
  confirmTotpEnrollment,
  removeTotpFactor,
  verifyStepUpCode,
} from "@/core/auth/two-factor";
import { LOGIN_CHALLENGE_COOKIE } from "@/core/auth/two-factor";
import { POST as loginRoute } from "../../app/api/auth/login/route";
import { POST as verifyLoginRoute } from "../../app/api/auth/login/verify/route";
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  isPrivilegedGrants,
  matchingTotpStep,
  totpCode,
} from "@/core/auth/two-factor-crypto";
import { actorFromToken } from "@/core/http/actor";
import { createRole } from "@/core/roles/service";
import { hasModuleAccess } from "@/core/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const USER_ID = "00000000-0000-4000-8000-000000000091";
const PASSWORD = "a-long-owner-password-for-two-factor";

describe("two-factor cryptography", () => {
  it("encrypts TOTP seeds with authenticated encryption", () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTwoFactorSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptTwoFactorSecret(encrypted)).toBe(secret);
    expect(() => decryptTwoFactorSecret(`${encrypted.slice(0, -1)}x`)).toThrow();
  });

  it("matches the RFC 6238 SHA-1 vector and only its adjacent window", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpCode(secret, 1)).toBe("287082");
    expect(matchingTotpStep(secret, "287082", 30_000)).toBe(1);
    expect(matchingTotpStep(secret, "000000", 30_000)).toBeUndefined();
  });

  it("normalizes recovery-code separators without weakening entropy", () => {
    const [code] = generateRecoveryCodes(1);
    expect(code).toMatch(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/);
    expect(hashRecoveryCode(code!)).toBe(hashRecoveryCode(code!.toLowerCase().replaceAll("-", " ")));
  });

  it("derives privilege from security administration grants, not role names", () => {
    expect(isPrivilegedGrants([{ module: "roles", access: "manage" }])).toBe(true);
    expect(isPrivilegedGrants([{ module: "admin", access: "view" }])).toBe(false);
  });
});

describe("step-up enforcement", () => {
  it("masks grants while mandatory 2FA is incomplete", () => {
    expect(
      hasModuleAccess(
        {
          kind: "user",
          userId: USER_ID,
          role: "anything",
          grants: [{ module: "*", access: "manage" }],
          security: {
            twoFactorRequired: true,
            twoFactorEnrolled: false,
            twoFactorVerified: false,
            stepUpValid: false,
          },
        },
        "admin",
      ),
    ).toBe(false);
  });

  it("refuses a declared critical service before opening the database", async () => {
    const error = await failure(
      createRole.call(
        { name: "Nope", grants: [] },
        {
          kind: "user",
          userId: USER_ID,
          role: "administrator",
          grants: [{ module: "roles", access: "manage" }],
          security: {
            twoFactorRequired: true,
            twoFactorEnrolled: true,
            twoFactorVerified: true,
            stepUpValid: false,
          },
        },
      ),
    );
    expect(error.code).toBe("step_up_required");
  });
});

describe.runIf(hasDatabase)("the two-factor lifecycle", () => {
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({
      id: USER_ID,
      email: "owner-2fa@example.test",
      passwordHash: await hashPassword(PASSWORD),
      role: "owner",
    });
  });
  afterAll(closeDb);

  it("forces a privileged session through enrollment and rejects TOTP replay", async () => {
    const session = await db().transaction((tx) => createSession(tx, USER_ID));
    const limited = await actorFromToken(session.token);
    expect(limited).toMatchObject({
      kind: "user",
      security: { twoFactorRequired: true, twoFactorEnrolled: false },
    });
    expect(hasModuleAccess(limited, "admin")).toBe(false);

    const begun = await beginTotpEnrollment.call({}, limited);
    const step = Math.floor(Date.now() / 30_000);
    const code = totpCode(begun.secret, step);
    const confirmed = await confirmTotpEnrollment.call(
      { enrollmentToken: begun.enrollmentToken, code },
      limited,
    );
    expect(confirmed.recoveryCodes).toHaveLength(10);

    const verified = await actorFromToken(session.token);
    expect(verified).toMatchObject({
      security: {
        twoFactorRequired: true,
        twoFactorEnrolled: true,
        twoFactorVerified: true,
        stepUpValid: true,
      },
    });
    expect(hasModuleAccess(verified, "admin")).toBe(true);
    const passkey = await beginWebAuthnRegistration.call({}, verified);
    expect(passkey.registrationToken.length).toBeGreaterThan(20);
    expect(passkey.options.challenge).toBeTruthy();
    expect(passkey.options.user.name).toBe("owner-2fa@example.test");
    expect((await failure(removeTotpFactor.call({}, verified))).code).toBe("conflict");
    expect((await failure(verifyStepUpCode.call({ code }, verified))).code).toBe("permission");
    await expect(
      verifyStepUpCode.call({ code: totpCode(begun.secret, step + 1) }, verified),
    ).resolves.toMatchObject({ ok: true, method: "totp" });
  });

  it("creates no session before factor proof and spends a recovery code once under concurrency", async () => {
    const original = await db().transaction((tx) => createSession(tx, USER_ID));
    const actor = await actorFromToken(original.token);
    const begun = await beginTotpEnrollment.call({}, actor);
    const enrolled = await confirmTotpEnrollment.call(
      {
        enrollmentToken: begun.enrollmentToken,
        code: totpCode(begun.secret, Math.floor(Date.now() / 30_000)),
      },
      actor,
    );
    const recoveryCode = enrolled.recoveryCodes[0]!;

    const first = await login.call(
      { email: "owner-2fa@example.test", password: PASSWORD },
      ANONYMOUS,
    );
    const second = await login.call(
      { email: "owner-2fa@example.test", password: PASSWORD },
      ANONYMOUS,
    );
    expect(first.twoFactorRequired).toBe(true);
    expect(first.token).toBe("");

    const attempts = await Promise.allSettled([
      completeTwoFactorLogin.call(
        { challengeToken: first.challengeToken, code: recoveryCode },
        ANONYMOUS,
      ),
      completeTwoFactorLogin.call(
        { challengeToken: second.challengeToken, code: recoveryCode },
        ANONYMOUS,
      ),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps the pending login token in an HttpOnly cookie and completes through the auth route", async () => {
    const original = await db().transaction((tx) => createSession(tx, USER_ID));
    const actor = await actorFromToken(original.token);
    const begun = await beginTotpEnrollment.call({}, actor);
    const enrolled = await confirmTotpEnrollment.call(
      {
        enrollmentToken: begun.enrollmentToken,
        code: totpCode(begun.secret, Math.floor(Date.now() / 30_000)),
      },
      actor,
    );
    const pending = await loginRoute(
      new Request("https://example.test/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0",
          "x-forwarded-for": "203.0.113.44",
        },
        body: JSON.stringify({ email: "owner-2fa@example.test", password: PASSWORD }),
      }),
    );
    expect(pending.status).toBe(200);
    const pendingCookies = pending.headers.getSetCookie();
    expect(pendingCookies.some((value) => value.startsWith(`${LOGIN_CHALLENGE_COOKIE}=`))).toBe(true);
    expect(pendingCookies.some((value) => value.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    const challengeCookie = pendingCookies[0]!.split(";")[0]!;

    const completed = await verifyLoginRoute(
      new Request("https://example.test/api/auth/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: challengeCookie },
        body: JSON.stringify({ code: enrolled.recoveryCodes[0] }),
      }),
    );
    expect(completed.status).toBe(200);
    expect(completed.headers.getSetCookie().some((value) => value.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    expect(completed.headers.getSetCookie().some((value) => value.includes(`${LOGIN_CHALLENGE_COOKIE}=`) && value.includes("Max-Age=0"))).toBe(true);
    const [newest] = await db()
      .select({ ip: sessions.ip, userAgent: sessions.userAgent })
      .from(sessions)
      .orderBy(desc(sessions.createdAt))
      .limit(1);
    expect(newest).toMatchObject({
      ip: "203.0.113.xxx",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0",
    });
    const activity = await db().select().from(loginSecurityEvents);
    expect(activity.at(-1)?.ipHint).toBe("203.0.113.xxx");
  });
});

describe("the additive two-factor migration", () => {
  it("adds assurance without removing the N-1 session or user columns", () => {
    const sql = readFileSync("db/migrations/0019_privileged-2fa-step-up.sql", "utf8");
    expect(sql).toContain('CREATE TABLE "totp_factors"');
    expect(sql).toContain('CREATE TABLE "webauthn_credentials"');
    expect(sql).toContain('ADD COLUMN "two_factor_verified_at"');
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)/);
  });
});
