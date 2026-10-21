// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { beginTrialCardSetup, joinMembership, startCardTrial } from "@/modules/subscriptions/public-signup";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../../i18n";

function safeProviderCheckout(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("unsafe checkout address");
  }
  return url.href;
}

async function customerHref() {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const business = await currentBusiness();
  const locale = await getLocale();
  const href = (path: string) => (business ? localizeCustomerHref(path, locale, business) : path);
  return { actor, href };
}

export async function joinMembershipAction(form: FormData): Promise<void> {
  const { actor, href } = await customerHref();
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  let result;
  try {
    result = await joinMembership.call(
      {
        planId: text("planId"),
        termsHash: text("termsHash"),
        requestKey: text("requestKey"),
        acceptedTerms: (form.get("acceptedTerms") === "yes") as true,
        paymentMethodId: text("paymentMethodId") || undefined,
      },
      actor,
    );
  } catch {
    redirect(href("/memberships?error=signup"));
  }
  if (result.invoiceId) redirect(href(`/portal/invoices/${result.invoiceId}`));
  if (!result.cardSetup) redirect(href(`/portal/subscriptions/${result.id}`));
  if (form.get("saveMethodConsent") !== "yes") redirect(href(`/portal/subscriptions/${result.id}`));
  let checkout: string;
  try {
    const setup = await beginTrialCardSetup.call({ subscriptionId: result.id, saveMethodConsent: true }, actor);
    checkout = safeProviderCheckout(setup.url);
  } catch {
    redirect(href(`/portal/subscriptions/${result.id}?error=setup`));
  }
  redirect(checkout);
}

export async function continueTrialCardSetupAction(form: FormData): Promise<void> {
  const { actor, href } = await customerHref();
  const subscriptionId = form.get("subscriptionId");
  const id = typeof subscriptionId === "string" ? subscriptionId : "";
  const portal = href(`/portal/subscriptions/${encodeURIComponent(id)}`);
  if (form.get("saveMethodConsent") !== "yes") redirect(`${portal}?error=setup`);
  let checkout: string;
  try {
    const setup = await beginTrialCardSetup.call({ subscriptionId: id, saveMethodConsent: true }, actor);
    checkout = safeProviderCheckout(setup.url);
  } catch {
    redirect(`${portal}?error=setup`);
  }
  redirect(checkout);
}

export async function startTrialAction(form: FormData): Promise<void> {
  const { actor, href } = await customerHref();
  const subscriptionId = form.get("subscriptionId");
  const paymentMethodId = form.get("paymentMethodId");
  const id = typeof subscriptionId === "string" ? subscriptionId : "";
  const methodId = typeof paymentMethodId === "string" ? paymentMethodId : "";
  try {
    await startCardTrial.call({ subscriptionId: id, paymentMethodId: methodId }, actor);
  } catch {
    redirect(href(`/memberships/trial-return?subscription=${encodeURIComponent(id)}&error=start`));
  }
  redirect(href(`/portal/subscriptions/${encodeURIComponent(id)}`));
}
