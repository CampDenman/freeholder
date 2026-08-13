// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { encodeQR } from "qr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import {
  LOGIN_CHALLENGE_COOKIE,
  beginTotpEnrollment,
  beginWebAuthnRegistration,
  beginWebAuthnStepUp,
  completeTwoFactorLogin,
  completeWebAuthnLogin,
  confirmTotpEnrollment,
  finishWebAuthnRegistration,
  finishWebAuthnStepUp,
  regenerateRecoveryCodes,
  removeTotpFactor,
  removeWebAuthnFactor,
  verifyStepUpCode,
} from "@/core/auth/two-factor";
import { actorFromToken } from "@/core/http/actor";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { ServiceError } from "@/core/service";
import {
  revokeOtherSessions,
  revokeSession,
} from "@/core/auth/session-management/service";

export interface SecurityActionState {
  error?: string;
  saved?: boolean;
  enrollmentToken?: string;
  secret?: string;
  qrSvg?: string;
  recoveryCodes?: string[];
}

function present(error: unknown): SecurityActionState {
  if (error instanceof ServiceError) return { error: error.message };
  console.error("security action failed", error);
  return { error: "Something went wrong. Try again." };
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function currentActor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

async function establishSession(result: { token: string; expiresAt: Date }) {
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: result.expiresAt,
  });
  jar.set(CSRF_COOKIE, issueCsrfToken(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure,
    expires: result.expiresAt,
  });
  jar.delete(LOGIN_CHALLENGE_COOKIE);
}

export async function completeLoginCodeAction(
  _previous: SecurityActionState,
  form: FormData,
): Promise<SecurityActionState> {
  const token = (await cookies()).get(LOGIN_CHALLENGE_COOKIE)?.value;
  if (!token) return { error: "That sign-in attempt expired. Start again." };
  try {
    const result = await completeTwoFactorLogin.call(
      { challengeToken: token, code: field(form, "code") },
      { kind: "anonymous" },
    );
    await establishSession(result);
  } catch (error) {
    return present(error);
  }
  redirect("/admin");
}

export async function completeLoginWebAuthnAction(
  credentialResponse: Record<string, unknown>,
): Promise<SecurityActionState> {
  const token = (await cookies()).get(LOGIN_CHALLENGE_COOKIE)?.value;
  if (!token) return { error: "That sign-in attempt expired. Start again." };
  try {
    const result = await completeWebAuthnLogin.call(
      { challengeToken: token, credentialResponse },
      { kind: "anonymous" },
    );
    await establishSession(result);
  } catch (error) {
    return present(error);
  }
  redirect("/admin");
}

export async function beginTotpAction(): Promise<SecurityActionState> {
  try {
    const result = await beginTotpEnrollment.call({}, await currentActor());
    return {
      enrollmentToken: result.enrollmentToken,
      secret: result.secret,
      qrSvg: encodeQR(result.uri, "svg"),
    };
  } catch (error) {
    return present(error);
  }
}

export async function confirmTotpAction(
  _previous: SecurityActionState,
  form: FormData,
): Promise<SecurityActionState> {
  try {
    const result = await confirmTotpEnrollment.call(
      {
        enrollmentToken: field(form, "enrollmentToken"),
        code: field(form, "code"),
      },
      await currentActor(),
    );
    revalidatePath("/security");
    return { saved: true, recoveryCodes: result.recoveryCodes };
  } catch (error) {
    return present(error);
  }
}

export async function beginWebAuthnAction() {
  try {
    return await beginWebAuthnRegistration.call({}, await currentActor());
  } catch (error) {
    return present(error);
  }
}

export async function finishWebAuthnAction(input: {
  registrationToken: string;
  name: string;
  credentialResponse: Record<string, unknown>;
}): Promise<SecurityActionState> {
  try {
    const result = await finishWebAuthnRegistration.call(input, await currentActor());
    revalidatePath("/security");
    return { saved: true, recoveryCodes: result.recoveryCodes };
  } catch (error) {
    return present(error);
  }
}

export async function verifyStepUpCodeAction(
  _previous: SecurityActionState,
  form: FormData,
): Promise<SecurityActionState> {
  try {
    await verifyStepUpCode.call({ code: field(form, "code") }, await currentActor());
  } catch (error) {
    return present(error);
  }
  redirect(safeReturnTo(field(form, "returnTo")));
}

export async function beginWebAuthnStepUpAction() {
  try {
    return await beginWebAuthnStepUp.call({}, await currentActor());
  } catch (error) {
    return present(error);
  }
}

export async function finishWebAuthnStepUpAction(input: {
  verificationToken: string;
  credentialResponse: Record<string, unknown>;
  returnTo: string;
}): Promise<SecurityActionState> {
  try {
    await finishWebAuthnStepUp.call(input, await currentActor());
  } catch (error) {
    return present(error);
  }
  redirect(safeReturnTo(input.returnTo));
}

export async function regenerateRecoveryCodesAction(): Promise<SecurityActionState> {
  try {
    const result = await regenerateRecoveryCodes.call({}, await currentActor());
    revalidatePath("/security");
    return { saved: true, recoveryCodes: result.recoveryCodes };
  } catch (error) {
    return present(error);
  }
}

export async function removeTotpAction(): Promise<SecurityActionState> {
  try {
    await removeTotpFactor.call({}, await currentActor());
    revalidatePath("/security");
    return { saved: true };
  } catch (error) {
    return present(error);
  }
}

export async function removeWebAuthnAction(form: FormData): Promise<SecurityActionState> {
  try {
    await removeWebAuthnFactor.call({ id: field(form, "id") }, await currentActor());
    revalidatePath("/security");
    return { saved: true };
  } catch (error) {
    return present(error);
  }
}

export async function revokeSessionAction(form: FormData): Promise<SecurityActionState> {
  let current = false;
  try {
    const result = await revokeSession.call(
      { id: field(form, "id") },
      await currentActor(),
    );
    current = result.current;
  } catch (error) {
    return present(error);
  }
  if (current) {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    jar.delete(CSRF_COOKIE);
    redirect("/login");
  }
  revalidatePath("/security");
  return { saved: true };
}

export async function revokeOtherSessionsAction(): Promise<SecurityActionState> {
  try {
    await revokeOtherSessions.call({}, await currentActor());
  } catch (error) {
    return present(error);
  }
  revalidatePath("/security");
  return { saved: true };
}

function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/admin";
}
