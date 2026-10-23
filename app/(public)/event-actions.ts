// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The public event page's door into events.register (C6.11).
//
// A Server Action for the same reason submitPublicForm is one: the form works
// before any JavaScript has loaded, and Next verifies the request Origin for
// actions, so the mutation carries its own CSRF defence. Only result codes
// travel in the URL — never free text. A paid registration redirects straight
// to the invoice's private payment page the service returned; the seat is a
// held reservation until that invoice settles.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AlreadyRegisteredError, registerForEvent } from "@/modules/events/service";
import { PATH_HEADER } from "@/core/http/headers";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../i18n";
import { publicFailure } from "@/core/http/public-form-return";

/**
 * A signed-out visitor, carrying the request's client address so per-client
 * limits (the playground's among them) key on this visitor rather than on
 * one bucket every visitor shares.
 */
async function visitor() {
  return { kind: "anonymous" as const, request: requestMetadataFromHeaders(await headers()) };
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Where to come back to: this request's own path, localized — never a value
 * from the form, which would be an open redirect waiting for a crafted link.
 */
async function returnPath(): Promise<string> {
  const [requestHeaders, business, locale] = await Promise.all([
    headers(),
    currentBusiness(),
    getLocale(),
  ]);
  const barePath = requestHeaders.get(PATH_HEADER) ?? "/";
  return business ? localizeCustomerHref(barePath, locale, business) : barePath;
}

export async function registerForEventAction(form: FormData): Promise<void> {
  const slug = text(form, "eventSlug").slice(0, 180);
  const path = await returnPath();
  const join = path.includes("?") ? "&" : "?";

  let outcome: Awaited<ReturnType<typeof registerForEvent.call>>;
  try {
    outcome = await registerForEvent.call(
      {
        eventId: text(form, "eventId"),
        sessionId: text(form, "sessionId"),
        ticketId: text(form, "ticketId") || undefined,
        email: text(form, "email"),
        name: text(form, "name") || undefined,
        quantity: Math.max(1, Math.min(50, Number(text(form, "quantity")) || 1)),
        submissionToken: text(form, "submissionToken").slice(0, 128) || undefined,
      },
      await visitor(),
    );
  } catch (error) {
    // redirect() throws to do its work; let Next's own signals through.
    if (error && typeof error === "object" && "digest" in error) throw error;
    // Someone already holds this email's place and this is not a repeat of
    // their own submit: say so, point at their inbox, and hand over nothing —
    // no invoice link, in the playground or anywhere else.
    if (error instanceof AlreadyRegisteredError) {
      redirect(`${path}${join}eventAlreadyRegistered=${encodeURIComponent(slug)}`);
    }
    // The visitor sees a code; the audit log keeps the real reason. A public
    // form that explains *why* it refused is telling a script how to get past
    // it — full, duplicate and closed all read the same ("invalid"). Only the
    // coarse class travels: wait, unavailable here, or our fault.
    redirect(`${path}${join}eventError=${encodeURIComponent(slug)}&failure=${publicFailure(error)}`);
  }

  if (outcome.paymentUrl) {
    // Same-origin by construction (the service builds it from APP_URL); only
    // its path and query ever leave here.
    const url = new URL(outcome.paymentUrl);
    const href = `${url.pathname}${url.search}`;
    const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
    redirect(business ? localizeCustomerHref(href, locale, business) : href);
  }
  if (outcome.registration.status === "waitlisted") {
    redirect(`${path}${join}eventWaitlisted=${encodeURIComponent(slug)}`);
  }
  redirect(`${path}${join}eventRegistered=${encodeURIComponent(slug)}`);
}
