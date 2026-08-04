// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// Password reset, from the browser (MASTER.md §9, §13 step 1).
//
// Both actions are reachable without a session, which is the point — the
// person using them cannot sign in. Their defences are therefore in the
// services: rate limits keyed to the address, one answer whatever the address
// turns out to be, and a token that is hashed at rest, single-use and short.
import { requestPasswordReset, resetPassword } from "@/core/auth/reset";
import { ServiceError } from "@/core/service";

const ANONYMOUS = { kind: "anonymous" } as const;

export interface ResetState {
  error?: string;
  sent?: boolean;
  done?: boolean;
}

function present(error: unknown): ResetState {
  if (error instanceof ServiceError) return { error: error.message };
  console.error("reset action failed", error);
  return { error: "Something went wrong. Try again." };
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function requestResetAction(
  _previous: ResetState,
  form: FormData,
): Promise<ResetState> {
  try {
    await requestPasswordReset.call({ email: field(form, "email") }, ANONYMOUS);
    // `sent` regardless, because the service answers the same way regardless.
    // A screen that distinguished would undo the service's care.
    return { sent: true };
  } catch (error) {
    return present(error);
  }
}

export async function resetPasswordAction(
  _previous: ResetState,
  form: FormData,
): Promise<ResetState> {
  try {
    await resetPassword.call(
      { token: field(form, "token"), newPassword: field(form, "newPassword") },
      ANONYMOUS,
    );
    return { done: true };
  } catch (error) {
    return present(error);
  }
}
