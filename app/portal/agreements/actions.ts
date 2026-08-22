// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Signing, from the customer's side (C6.09, MASTER.md §4.3).
//
// The two identifying facts a signature needs beyond a name — where it came
// from and what it was signed with — are read *here*, from the request
// headers, and never accepted from the form. A browser can put anything in a
// hidden field, and evidence somebody could have typed is not evidence.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ServiceError } from "@/core/service";
import { declineContract, signContract } from "@/modules/contracts/service";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The address the request came from, as far as this deploy can honestly tell.
 *
 * Behind the reverse proxy the platform ships with, `x-forwarded-for` is the
 * client and the left-most entry is the one to keep. It is recorded as
 * evidence of where a signature came from, not relied on as identity — an
 * address is a fact about a request, not a fact about a person.
 */
async function requestOrigin(): Promise<{ ip: string | null; userAgent: string | null }> {
  const jar = await headers();
  const forwarded = jar.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() || jar.get("x-real-ip") || null,
    userAgent: jar.get("user-agent"),
  };
}

export async function signAgreementAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  const here = `/portal/agreements/${encodeURIComponent(token)}`;
  try {
    const origin = await requestOrigin();
    await signContract.call(
      {
        token,
        // Validated in the handler, never by disabling the button: an
        // autofilled name that looks empty to React must not be able to
        // silently stop somebody signing (§15.10).
        signerName: text(form, "signerName"),
        ip: origin.ip,
        userAgent: origin.userAgent,
      },
      { kind: "anonymous" },
    );
  } catch (error) {
    const message =
      error instanceof ServiceError
        ? error.message
        : "That could not be signed. Nothing has changed.";
    redirect(`${here}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(here);
  redirect(`${here}?saved=signed`);
}

export async function declineAgreementAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  const here = `/portal/agreements/${encodeURIComponent(token)}`;
  try {
    await declineContract.call(
      { token, reason: text(form, "reason") || undefined },
      { kind: "anonymous" },
    );
  } catch (error) {
    const message =
      error instanceof ServiceError ? error.message : "That could not be recorded.";
    redirect(`${here}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(here);
  redirect(`${here}?saved=declined`);
}
