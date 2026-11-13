// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// C12.38/C9.38: all audiences submit the same explicit shared-service consent.
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { quoteMerchantAmendment, quoteMyMerchantAmendment, acceptMerchantAmendment, acceptMyMerchantAmendment,
  retryMerchantAmendment, retryMyMerchantAmendment } from "@/modules/subscriptions/commercial-amendments";
function text(form: FormData, name: string) { const value = form.get(name); return typeof value === "string" ? value.trim() : ""; }
async function actor() { return { ...await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value), request: requestMetadataFromHeaders(await headers()) }; }
function selection(form: FormData) {
  const locale = text(form, "locale");
  if (!["en", "es", "fr", "ar"].includes(locale)) throw new ServiceError("validation", "Select a supported review language.");
  return { id: text(form, "id"), planId: text(form, "planId"), locale: locale as "en" | "es" | "fr" | "ar",
    taxDestination: { country: text(form, "taxCountry").toUpperCase(), region: text(form, "taxRegion") || undefined,
      postalCode: text(form, "taxPostalCode") || undefined, city: text(form, "taxCity") || undefined } };
}
export async function reviewCommercialAmendment(form: FormData) {
  try {
    const service = text(form, "audience") === "owner" ? quoteMerchantAmendment : quoteMyMerchantAmendment;
    return { review: await service.call(selection(form), await actor()), failed: false };
  } catch (error) { if (error instanceof ServiceError) return { review: null, failed: true }; throw error; }
}
export async function acceptCommercialAmendment(form: FormData) {
  try {
    if (text(form, "confirm") !== "yes") return { failed: true };
    const service = text(form, "audience") === "owner" ? acceptMerchantAmendment : acceptMyMerchantAmendment;
    await service.call({ ...selection(form), previousTermsId: text(form, "previousTermsId"), acceptedQuoteDigest: text(form, "acceptedQuoteDigest"), confirm: true }, await actor());
    revalidatePath(`/portal/subscriptions/${text(form, "id")}`); revalidatePath(`/admin/subscriptions/${text(form, "id")}`);
    return { failed: false };
  } catch (error) { if (error instanceof ServiceError) return { failed: true }; throw error; }
}
export async function retryCommercialAmendment(form: FormData) {
  try {
    const service = text(form, "audience") === "owner" ? retryMerchantAmendment : retryMyMerchantAmendment;
    await service.call({ id: text(form, "id") }, await actor());
    revalidatePath(`/portal/subscriptions/${text(form, "id")}`); revalidatePath(`/admin/subscriptions/${text(form, "id")}`);
    return { failed: false };
  } catch (error) { if (error instanceof ServiceError) return { failed: true }; throw error; }
}
