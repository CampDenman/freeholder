// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for calendar and mail-read OAuth (C11.09 F04). The handshake,
// incremental scopes and the refusal to redeem a calendar code as mail live
// in the services; these only start them from a button.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { beginCalendarOAuth } from "@/core/connections/calendar-oauth";
import { beginMailReadOAuth } from "@/core/connections/mail-read-oauth";
import { ownerFacing } from "./action-helpers";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function providerOf(form: FormData): "google" | "microsoft" | null {
  const value = text(form, "provider");
  return value === "google" || value === "microsoft" ? value : null;
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(path: string, error: unknown, fallback: string): never {
  if (error instanceof ServiceError && error.code === "step_up_required") {
    redirect(`/security/verify?returnTo=${encodeURIComponent(path)}`);
  }
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function beginCalendarOAuthAction(form: FormData): Promise<void> {
  const provider = providerOf(form);
  if (!provider) {
    redirect("/admin/calendar?error=Choose%20Google%20or%20Microsoft.");
  }
  let authorizationUrl: string;
  try {
    const begun = await beginCalendarOAuth.call(
      { provider, returnTo: "/admin/calendar" },
      await actor(),
    );
    authorizationUrl = begun.authorizationUrl;
  } catch (error) {
    refused("/admin/calendar", error, "That calendar could not be connected.");
  }
  redirect(authorizationUrl);
}

export async function beginMailReadOAuthAction(form: FormData): Promise<void> {
  const provider = providerOf(form);
  if (!provider) {
    redirect("/admin/inbox?error=Choose%20Google%20or%20Microsoft.");
  }
  let authorizationUrl: string;
  try {
    const begun = await beginMailReadOAuth.call(
      { provider, returnTo: "/admin/inbox" },
      await actor(),
    );
    authorizationUrl = begun.authorizationUrl;
  } catch (error) {
    refused("/admin/inbox", error, "That mailbox could not be connected.");
  }
  redirect(authorizationUrl);
}
