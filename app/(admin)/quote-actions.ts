// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the quotes workspace (C6.12). The state machine, the
// versioning and the refusal to edit a live quote all live in the services.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  createQuote,
  postQuoteMessage,
  reviseQuote,
  sendQuote,
  setQuoteItems,
} from "@/modules/quotes/service";
import { ownerFacing } from "./action-helpers";

const QUOTES = "/admin/quotes";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * Line items, out of the parallel arrays a plain HTML form posts.
 *
 * A Server Action rather than a client component, so the workspace works with
 * no JavaScript — the same bet the setup wizard and the public form make.
 */
function itemsFrom(form: FormData) {
  const descriptions = form.getAll("description");
  const prices = form.getAll("unitPrice");
  const optionals = form.getAll("optional");
  return descriptions
    .map((description, index) => ({
      description: typeof description === "string" ? description.trim() : "",
      // Pounds and pence in, integer minor units out. Money never becomes a
      // float on the way through (§15.4).
      unitPriceMinor: Math.round(Number(prices[index] ?? 0) * 100),
      optional: optionals[index] === "on",
      selected: true,
    }))
    .filter((item) => item.description.length > 0);
}

export async function createQuoteAction(form: FormData): Promise<void> {
  let created: string;
  try {
    const quote = await createQuote.call(
      {
        contactId: text(form, "contactId"),
        title: text(form, "title"),
        currency: text(form, "currency") || "GBP",
        validUntil: text(form, "validUntil")
          ? new Date(`${text(form, "validUntil")}T23:59:59Z`).toISOString()
          : null,
        terms: text(form, "terms") || null,
      },
      await actor(),
    );
    created = quote.id;
  } catch (error) {
    refused(error, QUOTES, "That quote could not be drafted.");
  }
  revalidatePath(QUOTES);
  redirect(`${QUOTES}/${created}`);
}

export async function setQuoteItemsAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    const items = itemsFrom(form);
    if (items.length === 0) {
      throw new ServiceError("validation", "Add at least one line.");
    }
    await setQuoteItems.call({ id, items }, await actor());
  } catch (error) {
    refused(error, `${QUOTES}/${id}`, "Those lines could not be saved.");
  }
  revalidatePath(`${QUOTES}/${id}`);
  redirect(`${QUOTES}/${id}?saved=lines`);
}

export async function sendQuoteAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    await sendQuote.call({ id }, await actor());
  } catch (error) {
    refused(error, `${QUOTES}/${id}`, "That quote could not be sent.");
  }
  revalidatePath(`${QUOTES}/${id}`);
  redirect(`${QUOTES}/${id}?saved=sent`);
}

export async function reviseQuoteAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    const items = itemsFrom(form);
    if (items.length === 0) {
      throw new ServiceError("validation", "A revision needs at least one line.");
    }
    await reviseQuote.call({ id, items }, await actor());
  } catch (error) {
    refused(error, `${QUOTES}/${id}`, "That revision could not be made.");
  }
  revalidatePath(`${QUOTES}/${id}`);
  redirect(`${QUOTES}/${id}?saved=revised`);
}

export async function replyToQuoteAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    await postQuoteMessage.call(
      { quoteId: id, body: text(form, "body") },
      await actor(),
    );
  } catch (error) {
    refused(error, `${QUOTES}/${id}`, "That reply could not be sent.");
  }
  revalidatePath(`${QUOTES}/${id}`);
  redirect(`${QUOTES}/${id}?saved=replied`);
}
