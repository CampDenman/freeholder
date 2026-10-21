// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.19 (MASTER.md §44.1): passkey-first sign-in for members and customers.
// Email proof stays the way in and the recovery path; a passkey makes return
// visits one tap. The ceremonies are the owner's (`auth.*Passkey*`,
// `auth.*WebAuthn*`); only the session and the landing page differ.
"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import {
  beginPasskeyLogin,
  beginWebAuthnRegistration,
  beginWebAuthnStepUp,
  completePasskeyLogin,
  finishWebAuthnRegistration,
  finishWebAuthnStepUp,
  removeWebAuthnFactor,
  verifyStepUpCode,
} from "@/core/auth/two-factor";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { safeCustomerReturnPath } from "@/core/portal/return-path";

const CHALLENGE_COOKIE = "freeholder_portal_passkey";

type Result = { error?: string; code?: string; ok?: boolean };

function present(error: unknown): Result {
  if (error instanceof ServiceError) return { error: error.message, code: error.code };
  console.error("portal passkey action failed", error);
  return { error: "Something went wrong. Try again." };
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function beginPortalPasskeyLogin(email: string) {
  try {
    const result = await beginPasskeyLogin.call({ email }, { kind: "anonymous", request: requestMetadataFromHeaders(await headers()) });
    (await cookies()).set(CHALLENGE_COOKIE, result.challengeToken, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600,
    });
    return { options: result.options };
  } catch (error) { return present(error); }
}

export async function finishPortalPasskeyLogin(credentialResponse: Record<string, unknown>, returnTo: string): Promise<Result> {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  if (!token) return { error: "That sign-in attempt expired. Start again." };
  try {
    const result = await completePasskeyLogin.call({ challengeToken: token, credentialResponse }, { kind: "anonymous", request: requestMetadataFromHeaders(await headers()) });
    const secure = process.env.NODE_ENV === "production";
    jar.set(SESSION_COOKIE, result.token, { httpOnly: true, sameSite: "lax", path: "/", secure, expires: result.expiresAt });
    jar.set(CSRF_COOKIE, issueCsrfToken(), { httpOnly: false, sameSite: "lax", path: "/", secure, expires: result.expiresAt });
    jar.delete(CHALLENGE_COOKIE);
  } catch (error) { return present(error); }
  redirect(safeCustomerReturnPath(returnTo));
}

export async function beginPortalPasskeyRegistration() {
  try {
    return await beginWebAuthnRegistration.call({}, await actor());
  } catch (error) { return present(error); }
}

export async function finishPortalPasskeyRegistration(input: { registrationToken: string; name: string; credentialResponse: Record<string, unknown> }): Promise<Result & { recoveryCodes?: string[] }> {
  try {
    const result = await finishWebAuthnRegistration.call(input, await actor());
    return { ok: true, recoveryCodes: result.recoveryCodes ?? undefined };
  } catch (error) { return present(error); }
}

/** For a lost device: a recovery code proves it is you, so the old passkey can go. */
export async function portalRecoveryStepUp(code: string): Promise<Result> {
  try {
    await verifyStepUpCode.call({ code }, await actor());
    return { ok: true };
  } catch (error) { return present(error); }
}

/** Removing or adding another passkey first proves it is you, with a passkey you hold. */
export async function beginPortalPasskeyStepUp() {
  try {
    return await beginWebAuthnStepUp.call({}, await actor());
  } catch (error) { return present(error); }
}

export async function finishPortalPasskeyStepUp(input: { verificationToken: string; credentialResponse: Record<string, unknown> }): Promise<Result> {
  try {
    await finishWebAuthnStepUp.call(input, await actor());
    return { ok: true };
  } catch (error) { return present(error); }
}

export async function removePortalPasskey(id: string): Promise<Result> {
  try {
    await removeWebAuthnFactor.call({ id }, await actor());
    return { ok: true };
  } catch (error) { return present(error); }
}
