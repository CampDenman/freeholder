// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for messaging numbers (C7.10). The one-default-per-purpose rule
// and the refusal to claim health nobody checked live in `core/messaging/sms`.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  checkNumberHealth,
  importMessagingNumbers,
  setRegistration,
  updateMessagingNumber,
} from "@/core/messaging/sms";
import { ownerFacing } from "./action-helpers";

const MESSAGING = "/admin/messaging";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${MESSAGING}?error=${encodeURIComponent(message)}`);
}

export async function importNumbersAction(): Promise<void> {
  try {
    await importMessagingNumbers.call({}, await actor());
  } catch (error) {
    refused(error, "Those numbers could not be read.");
  }
  revalidatePath(MESSAGING);
  redirect(`${MESSAGING}?saved=imported`);
}

export async function checkNumbersAction(): Promise<void> {
  try {
    await checkNumberHealth.call({}, await actor());
  } catch (error) {
    refused(error, "Those numbers could not be checked.");
  }
  revalidatePath(MESSAGING);
  redirect(`${MESSAGING}?saved=checked`);
}

export async function updateNumberAction(form: FormData): Promise<void> {
  try {
    await updateMessagingNumber.call(
      {
        id: text(form, "id"),
        label: text(form, "label") || null,
        purpose: (text(form, "purpose") || "transactional") as
          | "transactional"
          | "marketing"
          | "support",
        isDefault: text(form, "isDefault") === "on",
        active: text(form, "active") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That number could not be changed.");
  }
  revalidatePath(MESSAGING);
  redirect(`${MESSAGING}?saved=number`);
}

/**
 * Record how far a registration has got (C7.11).
 *
 * Owner-entered, because the platform cannot submit a 10DLC brand on somebody's
 * behalf — that is an identity claim with legal weight, made in the provider's
 * own console. What it can do is remember what was said and refuse to send
 * until it says approved.
 */
export async function setRegistrationAction(form: FormData): Promise<void> {
  try {
    await setRegistration.call(
      {
        id: text(form, "id"),
        kind: text(form, "kind") as "10dlc" | "toll_free_verification" | "sender_id",
        state: (text(form, "state") || "not_started") as
          | "not_required"
          | "not_started"
          | "submitted"
          | "in_review"
          | "approved"
          | "rejected"
          | "expired",
        brand: text(form, "brand") || null,
        campaign: text(form, "campaign") || null,
        reason: text(form, "reason") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That registration could not be recorded.");
  }
  revalidatePath(MESSAGING);
  redirect(`${MESSAGING}?saved=registration`);
}
