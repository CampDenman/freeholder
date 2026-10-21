// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the reviews workspace (C11.09 F04). Moderation rules —
// hiding still counts, rejecting does not — live in the services.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  moderateReview,
  replyToReview,
  requestReview,
} from "@/modules/reviews/service";
import { ownerFacing } from "./action-helpers";

const REVIEWS = "/admin/reviews";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${REVIEWS}?error=${encodeURIComponent(message)}`);
}

export async function moderateReviewAction(form: FormData): Promise<void> {
  const status = text(form, "status");
  if (status !== "approved" && status !== "hidden" && status !== "rejected") {
    redirect(`${REVIEWS}?error=${encodeURIComponent("Choose publish, hide or reject.")}`);
  }
  try {
    await moderateReview.call({ id: text(form, "id"), status }, await actor());
  } catch (error) {
    refused(error, "That review could not be moderated.");
  }
  revalidatePath(REVIEWS);
  redirect(`${REVIEWS}?saved=moderated`);
}

export async function replyToReviewAction(form: FormData): Promise<void> {
  try {
    await replyToReview.call(
      { id: text(form, "id"), body: text(form, "body") },
      await actor(),
    );
  } catch (error) {
    refused(error, "That reply could not be posted.");
  }
  revalidatePath(REVIEWS);
  redirect(`${REVIEWS}?saved=replied`);
}

export async function requestReviewAction(form: FormData): Promise<void> {
  const source = text(form, "source");
  let alreadyAsked = false;
  try {
    const asked = await requestReview.call(
      {
        email: text(form, "email"),
        name: text(form, "name") || undefined,
        source:
          source === "post_order" || source === "post_booking" || source === "manual"
            ? source
            : "manual",
      },
      await actor(),
    );
    alreadyAsked = asked.alreadyAsked;
  } catch (error) {
    refused(error, "That review could not be requested.");
  }
  revalidatePath(REVIEWS);
  redirect(`${REVIEWS}?saved=${alreadyAsked ? "already" : "asked"}`);
}
