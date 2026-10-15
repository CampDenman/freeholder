// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.08: a member lists things for sale and takes them down.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { archiveListing, createListing, LISTING_KINDS } from "@/modules/members/listings";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function createListingAction(form: FormData): Promise<void> {
  const kind = text(form, "kind");
  try {
    await createListing.call(
      {
        title: text(form, "title"),
        kind: (LISTING_KINDS as readonly string[]).includes(kind) ? (kind as (typeof LISTING_KINDS)[number]) : "physical",
        description: text(form, "description"),
        price: text(form, "price"),
        adult: form.get("adult") === "yes",
      },
      await actor(),
    );
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/portal/listings?error=${error.code}`);
    throw error;
  }
  redirect("/portal/listings?saved=1");
}

export async function archiveListingAction(form: FormData): Promise<void> {
  try {
    await archiveListing.call({ productId: text(form, "productId"), archived: text(form, "archived") === "yes" }, await actor());
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/portal/listings?error=${error.code}`);
    throw error;
  }
  redirect("/portal/listings?saved=1");
}
