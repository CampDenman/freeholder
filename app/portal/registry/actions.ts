// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { WISHLIST_SHARE_COOKIE } from "@/modules/catalog/cookies";
import { shareWishlist } from "@/modules/catalog/service";

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? error.message : fallback;
  redirect(`/portal/registry?error=${encodeURIComponent(message)}`);
}

export async function shareMyWishlistAction(): Promise<void> {
  try {
    const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
    const shared = await shareWishlist.call({}, actor);
    (await cookies()).set(WISHLIST_SHARE_COOKIE, shared.link, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/portal/registry",
      maxAge: 300,
    });
  } catch (error) {
    refused(error, "That gift list could not be shared.");
  }
  revalidatePath("/portal/registry");
  redirect("/portal/registry?invited=1");
}
