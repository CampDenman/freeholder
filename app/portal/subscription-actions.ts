// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Click-to-cancel from the portal (MASTER.md §4.15, C9.13).
//
// The contact is resolved from the session inside `subscriptions.cancelMine`,
// never from this form, so a crafted id can only ever reach the caller's own
// row. Confirmation is a required checkbox: a destructive action that fires
// on a single tap is how people cancel the wrong thing on a phone.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { ServiceError } from "@/core/service";
import { cancelMySubscription } from "@/modules/subscriptions/service";
import { getLocale } from "../i18n";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function portalHref(path: string): Promise<string> {
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  return business ? localizeCustomerHref(path, locale, business) : path;
}

export async function cancelMySubscriptionAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const back = await portalHref(id ? `/portal/subscriptions/${id}` : "/portal/subscriptions");
  if (text(form, "confirm") !== "yes") {
    redirect(`${back}?error=1`);
  }
  const actor = {
    ...(await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value)),
    request: requestMetadataFromHeaders(await headers()),
  };
  try {
    await cancelMySubscription.call({ id }, actor);
  } catch (error) {
    if (error instanceof ServiceError) {
      redirect(`${back}?error=1`);
    }
    throw error;
  }
  redirect(`${back}?cancelled=1`);
}
