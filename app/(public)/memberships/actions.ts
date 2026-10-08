// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { joinMembership } from "@/modules/subscriptions/public-signup";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../../i18n";
export async function joinMembershipAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const text = (key: string) => (() => { const value = form.get(key); return typeof value === "string" ? value : ""; })();
  const business = await currentBusiness();
  const locale = await getLocale();
  const href = (path: string) => business ? localizeCustomerHref(path, locale, business) : path;
  let result;
  try {
    result = await joinMembership.call({ planId:text("planId"),termsHash:text("termsHash"),requestKey:text("requestKey"),acceptedTerms:(form.get("acceptedTerms")==="yes") as true,paymentMethodId:text("paymentMethodId")||undefined }, actor);
  } catch { redirect(href("/memberships?error=signup")); }
  redirect(href(result.invoiceId ? `/portal/invoices/${result.invoiceId}` : `/portal/subscriptions/${result.id}`));
}
