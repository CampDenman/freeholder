// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Customer reply from the portal (MASTER.md §4.14, C10.28).
//
// The conversation id comes from the form, but the contact is resolved from
// the session inside `conversations.replyAsContact`, so a crafted id can only
// ever land in the caller's own thread. This never calls `conversations.reply`,
// which sends as the business.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { ServiceError } from "@/core/service";
import { replyAsContact } from "@/core/messaging/inbox";
import { getLocale } from "../i18n";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function portalHref(path: string): Promise<string> {
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  return business ? localizeCustomerHref(path, locale, business) : path;
}

export async function replyAsContactAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const body = text(form, "body");
  const back = await portalHref(id ? `/portal/messages/${id}` : "/portal/messages");
  if (!id || !body) {
    redirect(`${back}?error=1`);
  }
  const actor = {
    ...(await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value)),
    request: requestMetadataFromHeaders(await headers()),
  };
  try {
    await replyAsContact.call({ id, body }, actor);
  } catch (error) {
    if (error instanceof ServiceError) {
      redirect(`${back}?error=1`);
    }
    throw error;
  }
  redirect(`${back}?sent=1`);
}
