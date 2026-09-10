// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { beginCustomerCheckout, confirmCustomerPayment } from "@/modules/invoicing/customer-service";
import { customerInvoicePath } from "@/modules/invoicing/customer-tokens";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { env } from "@/core/env";
import { getLocale } from "../../i18n";

async function localized(path: string): Promise<string> {
  const business = await currentBusiness();
  return business ? localizeCustomerHref(path, await getLocale(), business) : path;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function payInvoiceAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const token = text(form, "token") || undefined;
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  let url: string;
  try {
    ({ url } = await beginCustomerCheckout.call({ id, token }, actor));
  } catch {
    const path = customerInvoicePath(id, token);
    redirect(await localized(`${path}${token ? "&" : "?"}error=payment`));
  }
  const destination = new URL(url);
  if (destination.origin === new URL(env().APP_URL).origin) redirect(await localized(destination.pathname + destination.search));
  redirect(url);
}

export async function confirmInvoicePaymentAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  const path = `/portal/invoices/confirmation/${encodeURIComponent(token)}`;
  try {
    await confirmCustomerPayment.call({ token }, { kind: "anonymous" });
  } catch {
    redirect(await localized(`${path}?error=payment`));
  }
  revalidatePath(path);
  redirect(await localized(path));
}
