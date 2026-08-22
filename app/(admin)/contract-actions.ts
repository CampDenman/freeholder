// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for agreements and their templates (C6.09, C6.14).
//
// Every rule — versioning a template rather than editing it, the customer
// signing before the business does, what a fingerprint covers — lives in the
// services. These are the door.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  archiveTemplate,
  countersignContract,
  issueFromTemplate,
  saveTemplate,
} from "@/modules/contracts/template-service";
import { voidContract } from "@/modules/contracts/service";
import { ownerFacing } from "./action-helpers";

const AGREEMENTS = "/admin/agreements";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${AGREEMENTS}?error=${encodeURIComponent(message)}`);
}

/**
 * Variable descriptions, out of the parallel arrays a plain form posts.
 *
 * An owner who has not described a variable still gets a working template —
 * the renderer leaves it visible and the save reports it — so this filters
 * blanks rather than refusing them.
 */
function variablesFrom(form: FormData) {
  const keys = form.getAll("variableKey");
  const labels = form.getAll("variableLabel");
  const fallbacks = form.getAll("variableFallback");
  // FormData yields `string | File`, and a File would stringify to
  // "[object File]" — so each value is type-checked rather than coerced.
  const asText = (value: FormDataEntryValue | undefined): string =>
    typeof value === "string" ? value.trim() : "";

  return keys
    .map((key, index) => {
      const name = asText(key);
      return {
        key: name,
        // A label nobody wrote falls back to the variable's own name, which
        // is still more use on screen than an empty cell.
        label: asText(labels[index]) || name,
        fallback: asText(fallbacks[index]) || null,
      };
    })
    .filter((variable) => /^[a-z][a-z0-9_]{0,40}$/i.test(variable.key));
}

export async function saveTemplateAction(form: FormData): Promise<void> {
  try {
    await saveTemplate.call(
      {
        name: text(form, "name"),
        kind: text(form, "kind") === "agreement" ? "agreement" : "waiver",
        title: text(form, "title"),
        body: text(form, "body"),
        variables: variablesFrom(form),
        requiresCountersignature: text(form, "requiresCountersignature") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That template could not be saved.");
  }
  revalidatePath(AGREEMENTS);
  redirect(`${AGREEMENTS}?saved=template`);
}

export async function archiveTemplateAction(form: FormData): Promise<void> {
  try {
    await archiveTemplate.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That template could not be withdrawn.");
  }
  revalidatePath(AGREEMENTS);
  redirect(`${AGREEMENTS}?saved=archived`);
}

export async function issueFromTemplateAction(form: FormData): Promise<void> {
  try {
    await issueFromTemplate.call(
      {
        templateId: text(form, "templateId"),
        contactId: text(form, "contactId"),
        subjectType: "contact",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That agreement could not be sent.");
  }
  revalidatePath(AGREEMENTS);
  redirect(`${AGREEMENTS}?saved=issued`);
}

export async function countersignAction(form: FormData): Promise<void> {
  try {
    await countersignContract.call(
      { id: text(form, "id"), signerName: text(form, "signerName") },
      await actor(),
    );
  } catch (error) {
    refused(error, "That could not be countersigned.");
  }
  revalidatePath(AGREEMENTS);
  redirect(`${AGREEMENTS}?saved=countersigned`);
}

export async function voidContractAction(form: FormData): Promise<void> {
  try {
    await voidContract.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That could not be withdrawn.");
  }
  revalidatePath(AGREEMENTS);
  redirect(`${AGREEMENTS}?saved=voided`);
}
