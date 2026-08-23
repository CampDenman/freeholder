// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the pipeline board (C7.01). Every rule — the lost reason,
// the same-pipeline check, the lifecycle derivation — lives in the services,
// so the board and the API move a deal through exactly the same door.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { decimalToMinor } from "@/adapters/payments/currency";
import { ServiceError } from "@/core/service";
import {
  createDeal,
  installPipelineDefaults,
  moveContactStage,
  moveDeal,
} from "@/modules/crm/service";
import { ownerFacing } from "./action-helpers";

const PIPELINE = "/admin/pipeline";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${PIPELINE}?error=${encodeURIComponent(message)}`);
}

export async function installDefaultsAction(): Promise<void> {
  try {
    await installPipelineDefaults.call({}, await actor());
  } catch (error) {
    refused(error, "Those could not be set up.");
  }
  revalidatePath(PIPELINE);
  redirect(`${PIPELINE}?saved=installed`);
}

export async function createDealAction(form: FormData): Promise<void> {
  try {
    const currency = text(form, "currency") || "GBP";
    await createDeal.call(
      {
        contactId: text(form, "contactId"),
        title: text(form, "title"),
        // Pounds and pence in, integer minor units out (§15.4).
        valueMinor: decimalToMinor(text(form, "value") || "0", currency),
        currency,
        expectedCloseOn: text(form, "expectedCloseOn") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That deal could not be opened.");
  }
  revalidatePath(PIPELINE);
  redirect(`${PIPELINE}?saved=opened`);
}

export async function moveDealAction(form: FormData): Promise<void> {
  try {
    await moveDeal.call(
      {
        id: text(form, "id"),
        stageId: text(form, "stageId"),
        // Only meaningful for a stage that means "lost"; the service refuses
        // without it rather than the screen having to know which stages do.
        lostReason: text(form, "lostReason") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That deal could not be moved.");
  }
  revalidatePath(PIPELINE);
  redirect(`${PIPELINE}?saved=moved`);
}

export async function moveContactStageAction(form: FormData): Promise<void> {
  try {
    await moveContactStage.call(
      { contactId: text(form, "contactId"), stageId: text(form, "stageId") },
      await actor(),
    );
  } catch (error) {
    refused(error, "That could not be moved.");
  }
  revalidatePath(PIPELINE);
  redirect(`${PIPELINE}?saved=moved&view=lifecycle`);
}
