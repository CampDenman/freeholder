// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the hire desk (C6.10). Every rule — what may be hired, what
// a return comes to, whether the thing is free — lives in the services, and
// the double-booking refusal comes from the database underneath them.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { closeHire, handOver, takeBack } from "@/modules/rentals/service";
import { ownerFacing } from "./action-helpers";

const HIRE = "/admin/hire";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${HIRE}?error=${encodeURIComponent(message)}`);
}

export async function handOverAction(form: FormData): Promise<void> {
  try {
    await handOver.call(
      { id: text(form, "id"), condition: text(form, "condition") || undefined },
      await actor(),
    );
  } catch (error) {
    refused(error, "That could not be handed over.");
  }
  revalidatePath(HIRE);
  redirect(`${HIRE}?saved=out`);
}

export async function takeBackAction(form: FormData): Promise<void> {
  const condition = text(form, "condition");
  try {
    await takeBack.call(
      {
        id: text(form, "id"),
        condition:
          condition === "damaged" || condition === "lost" ? condition : "fine",
        notes: text(form, "notes") || undefined,
        // Only meaningful under a repair-cost policy; the service ignores it
        // otherwise rather than the screen having to know which policy applies.
        repairCostMinor: Number(text(form, "repairCostMinor")) || undefined,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That return could not be recorded.");
  }
  revalidatePath(HIRE);
  redirect(`${HIRE}?saved=back`);
}

export async function closeHireAction(form: FormData): Promise<void> {
  try {
    await closeHire.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That hire could not be closed.");
  }
  revalidatePath(HIRE);
  redirect(`${HIRE}?saved=closed`);
}
