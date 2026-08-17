// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Public quote, chat and tip blocks land on the contact spine (C2.09).
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { PATH_HEADER } from "@/core/http/headers";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../i18n";
import {
  submitQuoteRequest,
  submitSiteChat,
  submitTipIntent,
} from "@/modules/cms/inbound";

const ANONYMOUS = { kind: "anonymous" } as const;

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function submitInboundAction(form: FormData): Promise<void> {
  const requestHeaders = await headers();
  const barePath = requestHeaders.get(PATH_HEADER) ?? "/";
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  const path = business ? localizeCustomerHref(barePath, locale, business) : barePath;
  const kind = text(form, "kind");

  try {
    if (kind === "quote") {
      await submitQuoteRequest.call(
        { name: text(form, "name"), email: text(form, "email"), message: text(form, "message") },
        ANONYMOUS,
      );
      redirect(`${path}?quoted=1`);
    }
    if (kind === "chat") {
      await submitSiteChat.call(
        { name: text(form, "name"), email: text(form, "email"), message: text(form, "message") },
        ANONYMOUS,
      );
      redirect(`${path}?chatted=1`);
    }
    if (kind === "tip") {
      await submitTipIntent.call(
        {
          email: text(form, "email"),
          name: text(form, "name") || undefined,
          amountMinor: Number(text(form, "amountMinor")),
          currency: text(form, "currency") || "USD",
          message: text(form, "message") || undefined,
        },
        ANONYMOUS,
      );
      redirect(`${path}?tipped=1`);
    }
  } catch (error) {
    if (typeof error === "object" && error && "digest" in error) throw error;
    redirect(`${path}?inboundError=1`);
  }
  redirect(`${path}?inboundError=1`);
}
