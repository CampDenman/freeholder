// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// TOTP, recovery codes, WebAuthn and fresh-authentication services for
// MASTER.md §43 C1.03. All bearer challenge tokens are HMACed at rest.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, count, eq, gt, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import {
  sessions,
  totpFactors,
  twoFactorChallenges,
  twoFactorRecoveryCodes,
  users,
  webauthnCredentials,
} from "@/core/auth/schema";
import {
  createSession,
  describeDevice,
  markSessionStepUp,
  type ProtectedSessionMetadata,
} from "@/core/auth/sessions";
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  generateChallengeToken,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hashTwoFactorToken,
  matchingTotpStep,
} from "@/core/auth/two-factor-crypto";
import { env } from "@/core/env";
import { defineService, ServiceError, type Actor, type Tx } from "@/core/service";
import { recordSuccessfulLogin } from "@/core/auth/session-management/service";

export const LOGIN_CHALLENGE_COOKIE = "freeholder_login_challenge";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
// WebAuthn responses are structured JSON whose cryptographic shape is fully
// checked by SimpleWebAuthn. A record keeps the HTTP/OpenAPI contract honest
// without maintaining a second, inevitably stale copy of the W3C structure.
const responseValue = z.record(z.string(), z.unknown());

function relyingParty(): { origin: string; rpID: string } {
  const origin = env().APP_URL.replace(/\/+$/, "");
  return { origin, rpID: new URL(origin).hostname };
}

function userActor(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind !== "user") {
    throw new ServiceError("permission", "Sign in to manage two-factor authentication.");
  }
  return actor;
}

function requireSession(actor: Actor): Extract<Actor, { kind: "user" }> & { sessionId: string } {
  const user = userActor(actor);
  if (!user.sessionId) throw new ServiceError("permission", "Use a browser session to continue.");
  return user as typeof user & { sessionId: string };
}

async function credentialsFor(tx: Tx, userId: string) {
  return tx
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
}

async function recoveryCodesIfMissing(tx: Tx, userId: string): Promise<string[]> {
  const [existing] = await tx
    .select({ n: count() })
    .from(twoFactorRecoveryCodes)
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        isNull(twoFactorRecoveryCodes.usedAt),
      ),
    );
  if ((existing?.n ?? 0) > 0) return [];
  const codes = generateRecoveryCodes();
  await tx.insert(twoFactorRecoveryCodes).values(
    codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
  );
  return codes;
}

async function challenge(
  tx: Tx,
  userId: string,
  purpose: "login" | "totp-enrollment" | "webauthn-registration" | "webauthn-step-up",
  values: {
    challenge?: string;
    pendingSecret?: string;
    loginMetadata?: ProtectedSessionMetadata;
  } = {},
) {
  const token = generateChallengeToken();
  await tx.insert(twoFactorChallenges).values({
    userId,
    purpose,
    tokenHash: hashTwoFactorToken(token),
    challenge: values.challenge,
    pendingSecret: values.pendingSecret,
    ipHint: values.loginMetadata?.ipHint,
    userAgent: values.loginMetadata?.userAgent,
    deviceHash: values.loginMetadata?.deviceHash,
    networkHash: values.loginMetadata?.networkHash,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  return token;
}

async function activeChallenge(
  tx: Tx,
  token: string,
  purpose: "login" | "totp-enrollment" | "webauthn-registration" | "webauthn-step-up",
  userId?: string,
) {
  const conditions = [
    eq(twoFactorChallenges.tokenHash, hashTwoFactorToken(token)),
    eq(twoFactorChallenges.purpose, purpose),
    isNull(twoFactorChallenges.usedAt),
    gt(twoFactorChallenges.expiresAt, new Date()),
  ];
  if (userId) conditions.push(eq(twoFactorChallenges.userId, userId));
  const [row] = await tx
    .select()
    .from(twoFactorChallenges)
    .where(and(...conditions))
    .limit(1);
  if (!row) throw new ServiceError("permission", "That verification attempt expired. Start again.");
  return row;
}

async function spendChallenge(tx: Tx, id: string): Promise<void> {
  const [spent] = await tx
    .update(twoFactorChallenges)
    .set({ usedAt: new Date() })
    .where(and(eq(twoFactorChallenges.id, id), isNull(twoFactorChallenges.usedAt)))
    .returning({ id: twoFactorChallenges.id });
  if (!spent) throw new ServiceError("conflict", "That verification attempt was already used.");
}

async function consumeCode(tx: Tx, userId: string, code: string): Promise<"totp" | "recovery"> {
  if (/^\d{6}$/.test(code)) {
    const [factor] = await tx
      .select()
      .from(totpFactors)
      .where(eq(totpFactors.userId, userId))
      .limit(1);
    if (factor) {
      const step = matchingTotpStep(decryptTwoFactorSecret(factor.encryptedSecret), code);
      if (step !== undefined) {
        const [used] = await tx
          .update(totpFactors)
          .set({ lastUsedStep: step, lastUsedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(totpFactors.userId, userId),
              or(isNull(totpFactors.lastUsedStep), lt(totpFactors.lastUsedStep, step)),
            ),
          )
          .returning({ userId: totpFactors.userId });
        if (used) return "totp";
      }
    }
  }
  const [recovered] = await tx
    .update(twoFactorRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        eq(twoFactorRecoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(twoFactorRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: twoFactorRecoveryCodes.id });
  if (recovered) return "recovery";
  throw new ServiceError("permission", "That verification code is not valid.");
}

async function verifyWebAuthn(
  tx: Tx,
  userId: string,
  expectedChallenge: string,
  response: AuthenticationResponseJSON,
): Promise<void> {
  const [credential] = await tx
    .select()
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.userId, userId),
        eq(webauthnCredentials.credentialId, response.id),
      ),
    )
    .limit(1);
  if (!credential) throw new ServiceError("permission", "That security key is not registered here.");
  const { origin, rpID } = relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, "base64url"),
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
    });
  } catch {
    throw new ServiceError("permission", "The security key response could not be verified.");
  }
  if (!verification.verified) throw new ServiceError("permission", "The security key response could not be verified.");
  await tx
    .update(webauthnCredentials)
    .set({
      counter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      deviceType: verification.authenticationInfo.credentialDeviceType,
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(webauthnCredentials.id, credential.id));
}

export async function createLoginChallenge(
  tx: Tx,
  userId: string,
  loginMetadata?: ProtectedSessionMetadata,
) {
  const credentials = await credentialsFor(tx, userId);
  const [[totp], [recovery]] = await Promise.all([
    tx.select({ userId: totpFactors.userId }).from(totpFactors).where(eq(totpFactors.userId, userId)).limit(1),
    tx.select({ n: count() }).from(twoFactorRecoveryCodes).where(and(eq(twoFactorRecoveryCodes.userId, userId), isNull(twoFactorRecoveryCodes.usedAt))),
  ]);
  if (!totp && credentials.length === 0) return undefined;
  let webauthnOptions;
  let webauthnChallenge: string | undefined;
  if (credentials.length > 0) {
    const { rpID } = relyingParty();
    webauthnOptions = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
    });
    webauthnChallenge = webauthnOptions.challenge;
  }
  const challengeToken = await challenge(tx, userId, "login", {
    challenge: webauthnChallenge,
    loginMetadata,
  });
  return {
    challengeToken,
    methods: { totp: Boolean(totp), recovery: (recovery?.n ?? 0) > 0, webauthn: credentials.length > 0 },
    webauthnOptions,
  };
}

export const loginChallengeDetails = defineService({
  name: "auth.loginChallengeDetails",
  summary: "Describe the available methods for a pending two-factor login.",
  kind: "query",
  permission: "public",
  input: z.object({ challengeToken: z.string().min(20) }),
  handler: async (input, ctx) => {
    const row = await activeChallenge(ctx.tx, input.challengeToken, "login");
    const credentials = await credentialsFor(ctx.tx, row.userId);
    const [[totp], [recovery]] = await Promise.all([
      ctx.tx.select({ userId: totpFactors.userId }).from(totpFactors).where(eq(totpFactors.userId, row.userId)).limit(1),
      ctx.tx.select({ n: count() }).from(twoFactorRecoveryCodes).where(and(eq(twoFactorRecoveryCodes.userId, row.userId), isNull(twoFactorRecoveryCodes.usedAt))),
    ]);
    let webauthnOptions;
    if (row.challenge && credentials.length > 0) {
      const { rpID } = relyingParty();
      webauthnOptions = await generateAuthenticationOptions({
        rpID,
        challenge: row.challenge,
        userVerification: "required",
        allowCredentials: credentials.map((credential) => ({
          id: credential.credentialId,
          transports: credential.transports as AuthenticatorTransportFuture[],
        })),
      });
    }
    return {
      methods: { totp: Boolean(totp), recovery: (recovery?.n ?? 0) > 0, webauthn: credentials.length > 0 },
      webauthnOptions,
    };
  },
});

const completeLoginInput = z.object({
  challengeToken: z.string().min(20),
  code: z.string().trim().min(6).max(40),
});

export const completeTwoFactorLogin = defineService({
  name: "auth.completeTwoFactorLogin",
  summary: "Finish a password login with TOTP or a recovery code.",
  kind: "mutation",
  permission: "public",
  input: completeLoginInput,
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => hashTwoFactorToken(input.challengeToken),
    message: "Too many verification attempts. Start sign-in again.",
  },
  handler: async (input, ctx) => {
    const row = await activeChallenge(ctx.tx, input.challengeToken, "login");
    const method = await consumeCode(ctx.tx, row.userId, input.code);
    await spendChallenge(ctx.tx, row.id);
    await ctx.tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.userId));
    const metadata = {
      ipHint: row.ipHint ?? undefined,
      userAgent: row.userAgent ?? undefined,
      deviceHash: row.deviceHash ?? undefined,
      networkHash: row.networkHash ?? undefined,
      deviceLabel: describeDevice(row.userAgent),
    };
    const session = await createSession(ctx.tx, row.userId, {
      ...metadata,
      twoFactorVerified: true,
    });
    await recordSuccessfulLogin(
      ctx.tx,
      row.userId,
      session.sessionId,
      metadata,
    );
    ctx.setSubject("user", row.userId);
    return { userId: row.userId, method, ...session };
  },
});

export const completeWebAuthnLogin = defineService({
  name: "auth.completeWebAuthnLogin",
  summary: "Finish a password login with a passkey or security key.",
  kind: "mutation",
  permission: "public",
  input: z.object({
    challengeToken: z.string().min(20),
    credentialResponse: responseValue,
  }),
  rateLimit: {
    limit: 10,
    windowSeconds: 15 * 60,
    subject: (input) => hashTwoFactorToken(input.challengeToken),
    message: "Too many verification attempts. Start sign-in again.",
  },
  handler: async (input, ctx) => {
    const row = await activeChallenge(ctx.tx, input.challengeToken, "login");
    if (!row.challenge) throw new ServiceError("permission", "This sign-in did not request a security key.");
    await verifyWebAuthn(
      ctx.tx,
      row.userId,
      row.challenge,
      input.credentialResponse as unknown as AuthenticationResponseJSON,
    );
    await spendChallenge(ctx.tx, row.id);
    await ctx.tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.userId));
    const metadata = {
      ipHint: row.ipHint ?? undefined,
      userAgent: row.userAgent ?? undefined,
      deviceHash: row.deviceHash ?? undefined,
      networkHash: row.networkHash ?? undefined,
      deviceLabel: describeDevice(row.userAgent),
    };
    const session = await createSession(ctx.tx, row.userId, {
      ...metadata,
      twoFactorVerified: true,
    });
    await recordSuccessfulLogin(
      ctx.tx,
      row.userId,
      session.sessionId,
      metadata,
    );
    ctx.setSubject("user", row.userId);
    return { userId: row.userId, method: "webauthn" as const, ...session };
  },
});

export const twoFactorStatus = defineService({
  name: "auth.twoFactorStatus",
  summary: "Show the calling user's enrolled two-factor methods.",
  kind: "query",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const actor = userActor(ctx.actor);
    const [totp, credentials, [codes], [account]] = await Promise.all([
      ctx.tx.select({ createdAt: totpFactors.createdAt }).from(totpFactors).where(eq(totpFactors.userId, actor.userId)).limit(1),
      credentialsFor(ctx.tx, actor.userId),
      ctx.tx.select({ n: count() }).from(twoFactorRecoveryCodes).where(and(eq(twoFactorRecoveryCodes.userId, actor.userId), isNull(twoFactorRecoveryCodes.usedAt))),
      ctx.tx.select({ email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1),
    ]);
    return {
      email: account?.email ?? "",
      required: actor.security?.twoFactorRequired ?? false,
      verified: actor.security?.twoFactorVerified ?? false,
      stepUpValid: actor.security?.stepUpValid ?? false,
      totp: totp[0] ?? null,
      webauthn: credentials.map(({ publicKey: _publicKey, ...credential }) => credential),
      recoveryCodesRemaining: codes?.n ?? 0,
    };
  },
});

export const beginTotpEnrollment = defineService({
  name: "auth.beginTotpEnrollment",
  summary: "Begin enrolling an authenticator app.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const actor = requireSession(ctx.actor);
    const [existing] = await ctx.tx.select().from(totpFactors).where(eq(totpFactors.userId, actor.userId)).limit(1);
    if (existing) throw new ServiceError("conflict", "An authenticator app is already enrolled.");
    if (actor.security?.twoFactorEnrolled && !actor.security.stepUpValid) {
      throw new ServiceError("step_up_required", "Confirm your identity before adding another factor.");
    }
    const secret = generateTotpSecret();
    const enrollmentToken = await challenge(ctx.tx, actor.userId, "totp-enrollment", {
      pendingSecret: encryptTwoFactorSecret(secret),
    });
    const [account] = await ctx.tx.select({ email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1);
    const label = `Freeholder:${account?.email ?? actor.userId}`;
    const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=Freeholder&algorithm=SHA1&digits=6&period=30`;
    ctx.setSubject("user", actor.userId);
    return { enrollmentToken, secret, uri };
  },
});

export const confirmTotpEnrollment = defineService({
  name: "auth.confirmTotpEnrollment",
  summary: "Confirm an authenticator app and issue recovery codes.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ enrollmentToken: z.string().min(20), code: z.string().regex(/^\d{6}$/) }),
  handler: async (input, ctx) => {
    const actor = requireSession(ctx.actor);
    const row = await activeChallenge(ctx.tx, input.enrollmentToken, "totp-enrollment", actor.userId);
    if (!row.pendingSecret) throw new ServiceError("permission", "That enrollment cannot be completed.");
    const encryptedSecret = row.pendingSecret;
    const step = matchingTotpStep(decryptTwoFactorSecret(encryptedSecret), input.code);
    if (step === undefined) throw new ServiceError("permission", "That authenticator code is not valid.");
    await spendChallenge(ctx.tx, row.id);
    await ctx.tx.insert(totpFactors).values({
      userId: actor.userId,
      encryptedSecret,
      lastUsedStep: step,
      lastUsedAt: new Date(),
    });
    const recoveryCodes = await recoveryCodesIfMissing(ctx.tx, actor.userId);
    await markSessionStepUp(ctx.tx, actor.sessionId);
    await ctx.tx.delete(sessions).where(and(eq(sessions.userId, actor.userId), ne(sessions.id, actor.sessionId)));
    ctx.setSubject("user", actor.userId);
    return { ok: true, recoveryCodes };
  },
});

export const beginWebAuthnRegistration = defineService({
  name: "auth.beginWebAuthnRegistration",
  summary: "Begin registering a passkey or security key.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const actor = requireSession(ctx.actor);
    if (actor.security?.twoFactorEnrolled && !actor.security.stepUpValid) {
      throw new ServiceError("step_up_required", "Confirm your identity before adding another factor.");
    }
    const [account, existing] = await Promise.all([
      ctx.tx.select({ email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1),
      credentialsFor(ctx.tx, actor.userId),
    ]);
    const { rpID } = relyingParty();
    const options = await generateRegistrationOptions({
      rpName: "Freeholder",
      rpID,
      userName: account[0]?.email ?? actor.userId,
      userID: new TextEncoder().encode(actor.userId),
      attestationType: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
    });
    const registrationToken = await challenge(ctx.tx, actor.userId, "webauthn-registration", {
      challenge: options.challenge,
    });
    ctx.setSubject("user", actor.userId);
    return { registrationToken, options };
  },
});

export const finishWebAuthnRegistration = defineService({
  name: "auth.finishWebAuthnRegistration",
  summary: "Verify and store a passkey or security key.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({
    registrationToken: z.string().min(20),
    name: z.string().trim().min(1).max(80).default("Security key"),
    credentialResponse: responseValue,
  }),
  handler: async (input, ctx) => {
    const actor = requireSession(ctx.actor);
    const row = await activeChallenge(ctx.tx, input.registrationToken, "webauthn-registration", actor.userId);
    if (!row.challenge) throw new ServiceError("permission", "That registration cannot be completed.");
    const { origin, rpID } = relyingParty();
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: input.credentialResponse as unknown as RegistrationResponseJSON,
        expectedChallenge: row.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      throw new ServiceError("permission", "The security key registration could not be verified.");
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new ServiceError("permission", "The security key registration could not be verified.");
    }
    await spendChallenge(ctx.tx, row.id);
    const info = verification.registrationInfo;
    await ctx.tx.insert(webauthnCredentials).values({
      userId: actor.userId,
      credentialId: info.credential.id,
      name: input.name,
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    });
    const recoveryCodes = await recoveryCodesIfMissing(ctx.tx, actor.userId);
    await markSessionStepUp(ctx.tx, actor.sessionId);
    await ctx.tx.delete(sessions).where(and(eq(sessions.userId, actor.userId), ne(sessions.id, actor.sessionId)));
    ctx.setSubject("user", actor.userId);
    return { ok: true, recoveryCodes };
  },
});

export const verifyStepUpCode = defineService({
  name: "auth.verifyStepUpCode",
  summary: "Refresh sensitive-action authorization with TOTP or recovery code.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ code: z.string().trim().min(6).max(40) }),
  handler: async (input, ctx) => {
    const actor = requireSession(ctx.actor);
    const method = await consumeCode(ctx.tx, actor.userId, input.code);
    await markSessionStepUp(ctx.tx, actor.sessionId);
    ctx.setSubject("session", actor.sessionId);
    return { ok: true, method };
  },
});

export const beginWebAuthnStepUp = defineService({
  name: "auth.beginWebAuthnStepUp",
  summary: "Begin fresh verification with a passkey or security key.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({}),
  handler: async (_input, ctx) => {
    const actor = requireSession(ctx.actor);
    const credentials = await credentialsFor(ctx.tx, actor.userId);
    if (credentials.length === 0) throw new ServiceError("not_found", "No passkey or security key is enrolled.");
    const { rpID } = relyingParty();
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
    });
    const verificationToken = await challenge(ctx.tx, actor.userId, "webauthn-step-up", {
      challenge: options.challenge,
    });
    ctx.setSubject("session", actor.sessionId);
    return { verificationToken, options };
  },
});

export const finishWebAuthnStepUp = defineService({
  name: "auth.finishWebAuthnStepUp",
  summary: "Finish fresh verification with a passkey or security key.",
  kind: "mutation",
  permission: "authenticated",
  input: z.object({ verificationToken: z.string().min(20), credentialResponse: responseValue }),
  handler: async (input, ctx) => {
    const actor = requireSession(ctx.actor);
    const row = await activeChallenge(ctx.tx, input.verificationToken, "webauthn-step-up", actor.userId);
    if (!row.challenge) throw new ServiceError("permission", "That verification cannot be completed.");
    await verifyWebAuthn(ctx.tx, actor.userId, row.challenge, input.credentialResponse as unknown as AuthenticationResponseJSON);
    await spendChallenge(ctx.tx, row.id);
    await markSessionStepUp(ctx.tx, actor.sessionId);
    ctx.setSubject("session", actor.sessionId);
    return { ok: true };
  },
});

export const regenerateRecoveryCodes = defineService({
  name: "auth.regenerateRecoveryCodes",
  summary: "Replace every recovery code with a new one-use set.",
  kind: "mutation",
  permission: "authenticated",
  stepUp: true,
  input: z.object({}),
  handler: async (_input, ctx) => {
    const actor = requireSession(ctx.actor);
    await ctx.tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, actor.userId));
    const recoveryCodes = generateRecoveryCodes();
    await ctx.tx.insert(twoFactorRecoveryCodes).values(
      recoveryCodes.map((code) => ({ userId: actor.userId, codeHash: hashRecoveryCode(code) })),
    );
    ctx.setSubject("user", actor.userId);
    return { recoveryCodes };
  },
});

async function factorCount(tx: Tx, userId: string): Promise<number> {
  const [[totp], [webauthn]] = await Promise.all([
    tx.select({ n: count() }).from(totpFactors).where(eq(totpFactors.userId, userId)),
    tx.select({ n: count() }).from(webauthnCredentials).where(eq(webauthnCredentials.userId, userId)),
  ]);
  return (totp?.n ?? 0) + (webauthn?.n ?? 0);
}

function mayRemoveLast(actor: Extract<Actor, { kind: "user" }>, factors: number): void {
  if (factors <= 1 && actor.security?.twoFactorRequired) {
    throw new ServiceError("conflict", "Your role requires two-factor authentication. Add another factor before removing this one.");
  }
}

async function clearRecoveryAfterLastFactor(
  tx: Tx,
  userId: string,
  factorsBeforeRemoval: number,
): Promise<void> {
  if (factorsBeforeRemoval !== 1) return;
  await Promise.all([
    tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId)),
    tx
      .update(sessions)
      .set({ twoFactorVerifiedAt: null, stepUpAt: null })
      .where(eq(sessions.userId, userId)),
  ]);
}

export const removeTotpFactor = defineService({
  name: "auth.removeTotpFactor",
  summary: "Remove the calling user's authenticator app.",
  kind: "mutation",
  permission: "authenticated",
  stepUp: true,
  input: z.object({}),
  handler: async (_input, ctx) => {
    const actor = requireSession(ctx.actor);
    const factors = await factorCount(ctx.tx, actor.userId);
    mayRemoveLast(actor, factors);
    const [removed] = await ctx.tx.delete(totpFactors).where(eq(totpFactors.userId, actor.userId)).returning({ userId: totpFactors.userId });
    if (!removed) throw new ServiceError("not_found", "No authenticator app is enrolled.");
    await clearRecoveryAfterLastFactor(ctx.tx, actor.userId, factors);
    ctx.setSubject("user", actor.userId);
    return { ok: true };
  },
});

export const removeWebAuthnFactor = defineService({
  name: "auth.removeWebAuthnFactor",
  summary: "Remove one of the calling user's passkeys or security keys.",
  kind: "mutation",
  permission: "authenticated",
  stepUp: true,
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const actor = requireSession(ctx.actor);
    const factors = await factorCount(ctx.tx, actor.userId);
    mayRemoveLast(actor, factors);
    const [removed] = await ctx.tx
      .delete(webauthnCredentials)
      .where(and(eq(webauthnCredentials.id, input.id), eq(webauthnCredentials.userId, actor.userId)))
      .returning({ id: webauthnCredentials.id });
    if (!removed) throw new ServiceError("not_found", "That security key was not found.");
    await clearRecoveryAfterLastFactor(ctx.tx, actor.userId, factors);
    ctx.setSubject("webauthnCredential", input.id);
    return { ok: true };
  },
});

export const pruneTwoFactorChallenges = async (tx: Tx) =>
  tx
    .delete(twoFactorChallenges)
    .where(or(lt(twoFactorChallenges.expiresAt, new Date()), isNotNull(twoFactorChallenges.usedAt)))
    .returning({ id: twoFactorChallenges.id });

export default [
  loginChallengeDetails,
  completeTwoFactorLogin,
  completeWebAuthnLogin,
  twoFactorStatus,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  beginWebAuthnRegistration,
  finishWebAuthnRegistration,
  verifyStepUpCode,
  beginWebAuthnStepUp,
  finishWebAuthnStepUp,
  regenerateRecoveryCodes,
  removeTotpFactor,
  removeWebAuthnFactor,
];
