// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.09: a seller tells the site how to pay them.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { savePayoutInstructions } from "@/modules/members/payouts";
import { refreshPayoutAccount, startPayoutSetup } from "@/modules/members/provider-payouts";

export async function savePayoutInstructionsAction(form: FormData): Promise<void> {
  const value = form.get("instructions");
  try {
    await savePayoutInstructions.call(
      { instructions: typeof value === "string" ? value : "" },
      await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value),
    );
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/portal/payouts?error=${error.code}`);
    throw error;
  }
  redirect("/portal/payouts?saved=1");
}

// C12.26–C12.27: set up payouts with the site's provider, or check on it.
const SETUP_FIELDS = ["paypalEmail", "legalName", "phone", "street", "city", "state", "postalCode", "beneficiaryName", "accountNumber", "ifsc"] as const;

export async function startPayoutSetupAction(form: FormData): Promise<void> {
  const fields: Partial<Record<(typeof SETUP_FIELDS)[number], string>> = {};
  for (const name of SETUP_FIELDS) {
    const value = form.get(name);
    if (typeof value === "string" && value.trim()) fields[name] = value.trim();
  }
  let url: string | null = null;
  try {
    ({ url } = await startPayoutSetup.call({ fields }, await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value)));
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/portal/payouts?error=${error.code}`);
    throw error;
  }
  // A hosted setup continues on the provider's own page.
  redirect(url ?? "/portal/payouts?saved=1");
}

export async function refreshPayoutAccountAction(): Promise<void> {
  try {
    await refreshPayoutAccount.call({}, await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value));
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/portal/payouts?error=${error.code}`);
    throw error;
  }
  redirect("/portal/payouts?saved=1");
}
