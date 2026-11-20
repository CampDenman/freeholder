// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { quoteGrossProration, quoteMyGrossProration } from "@/modules/subscriptions/proration-quote";
import { collectProrationCard, collectMyProrationCard } from "@/modules/subscriptions/proration-card-service";
import { acceptGrossProration, acceptMyGrossProration } from "@/modules/subscriptions/proration-service";
function value(form: FormData, name: string) { const field = form.get(name); return typeof field === "string" ? field.trim() : ""; }
function selection(form: FormData) {
  const locale = value(form, "locale");
  if (!["en", "fr", "es", "ar"].includes(locale)) throw new ServiceError("validation", "Choose a supported consent language.");
  return { id: value(form, "id"), planId: value(form, "planId"), effectiveAt: value(form, "effectiveAt"), locale: locale as "en" | "fr" | "es" | "ar",
    taxDestination: { country: value(form, "taxCountry").toUpperCase(), region: value(form, "taxRegion") || undefined, postalCode: value(form, "taxPostalCode") || undefined, city: value(form, "taxCity") || undefined } };
}
async function actor() { return { ...await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value), request: requestMetadataFromHeaders(await headers()) }; }
export async function reviewGrossProration(form: FormData) {
  try { const service = value(form, "audience") === "owner" ? quoteGrossProration : quoteMyGrossProration;
    return { failed: false, review: await service.call(selection(form), await actor()) };
  } catch (error) { if (error instanceof ServiceError) return { failed: true, review: null }; throw error; }
}
export async function confirmGrossProration(form: FormData) {
  try {
    if (value(form, "confirm") !== "yes") return { failed: true };
    const service = value(form, "audience") === "owner" ? acceptGrossProration : acceptMyGrossProration;
    await service.call({ ...selection(form), previousTermsId: value(form, "previousTermsId"), acceptedQuoteDigest: value(form, "acceptedQuoteDigest"), confirm: true }, await actor());
    revalidatePath(`/admin/subscriptions/${value(form, "id")}`); revalidatePath(`/portal/subscriptions/${value(form, "id")}`);
    return { failed: false };
  } catch (error) { if (error instanceof ServiceError) return { failed: true }; throw error; }
}

export async function collectOriginalProrationCard(form: FormData) {
  try {
    const service = value(form, "audience") === "owner" ? collectProrationCard : collectMyProrationCard;
    await service.call({ prorationId: value(form, "prorationId") }, await actor());
    revalidatePath(`/admin/subscriptions/${value(form, "id")}`); revalidatePath(`/portal/subscriptions/${value(form, "id")}`);
    return { failed: false };
  } catch (error) { if (error instanceof ServiceError) return { failed: true }; throw error; }
}
