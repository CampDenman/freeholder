// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PATH_HEADER } from "@/core/http/headers";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../i18n";
import { subscribeToNewsletter } from "@/modules/newsletters/service";

const ANONYMOUS = { kind: "anonymous" } as const;

export async function subscribePublicNewsletter(form: FormData): Promise<void> {
  const newsletterRaw = form.get("newsletterId");
  const emailRaw = form.get("email");
  const newsletterId = typeof newsletterRaw === "string" ? newsletterRaw : "";
  const email = typeof emailRaw === "string" ? emailRaw : "";
  const statementRaw = form.get("consentStatement");
  const statement = typeof statementRaw === "string" ? statementRaw.trim().slice(0, 500) : "";
  const accepted = form.get("consent") === "on";
  const requestHeaders = await headers();
  const barePath = requestHeaders.get(PATH_HEADER) ?? "/";
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  const path = business ? localizeCustomerHref(barePath, locale, business) : barePath;
  const join = path.includes("?") ? "&" : "?";
  if (statement && !accepted) {
    redirect(`${path}${join}subscribeError=1`);
  }
  try {
    await subscribeToNewsletter.call(
      {
        newsletterId,
        email,
        // The sentence on the form is the terms. No statement, no extra record:
        // existing pages keep the double opt-in they already had.
        ...(statement
          ? {
              consent: {
                termsVersion: statement.slice(0, 100),
                sourceUrl: path,
                evidence: { popup: "newsletter-subscribe", statement },
              },
            }
          : {}),
      },
      ANONYMOUS,
    );
    redirect(`${path}${join}subscribed=1`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`${path}${join}subscribeError=1`);
  }
}
