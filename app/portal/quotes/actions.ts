// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// A prospect acting on their own quote (C6.12, MASTER.md §4.3).
//
// Every rule — whether the offer is still open, whether it has expired,
// whether an optional line may be toggled, what the total comes to — lives in
// the services. These are the door, and the refusal that comes back is the
// message: "this quote has expired, ask for a fresh one" is what somebody
// needs, and a generic failure would send them to the support email §4.3's
// pipeline exists to avoid.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ServiceError } from "@/core/service";
import {
  acceptQuote,
  chooseQuoteOptions,
  declineQuote,
  postQuoteMessage,
} from "@/modules/quotes/service";

const ANON = { kind: "anonymous" } as const;

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function here(token: string): string {
  return `/portal/quotes/${encodeURIComponent(token)}`;
}

function refused(error: unknown, token: string, fallback: string): never {
  const message = error instanceof ServiceError ? error.message : fallback;
  redirect(`${here(token)}?error=${encodeURIComponent(message)}`);
}

export async function chooseOptionsAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  try {
    await chooseQuoteOptions.call(
      {
        token,
        // An unticked checkbox posts nothing, so the absent ones are exactly
        // the ones being turned off — which is why the service takes the full
        // chosen set rather than a change.
        selectedItemIds: form
          .getAll("selectedItemIds")
          .filter((value): value is string => typeof value === "string"),
      },
      ANON,
    );
  } catch (error) {
    refused(error, token, "Those options could not be saved.");
  }
  revalidatePath(here(token));
  redirect(here(token));
}

export async function acceptQuoteAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  try {
    await acceptQuote.call(
      // Validated in the handler, never by disabling the button: an autofilled
      // name that looks empty to React must not silently stop somebody
      // accepting (§15.10).
      { token, acceptedName: text(form, "acceptedName") },
      ANON,
    );
  } catch (error) {
    refused(error, token, "That could not be accepted. Nothing has changed.");
  }
  revalidatePath(here(token));
  // The token is spent at acceptance, so the page it returns to is the
  // confirmation rather than the offer.
  redirect(`/portal/quotes/accepted`);
}

export async function declineQuoteAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  try {
    await declineQuote.call(
      { token, reason: text(form, "reason") || undefined },
      ANON,
    );
  } catch (error) {
    refused(error, token, "That could not be recorded.");
  }
  revalidatePath(here(token));
  redirect(`${here(token)}?saved=declined`);
}

export async function askAboutQuoteAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  try {
    await postQuoteMessage.call({ token, body: text(form, "body") }, ANON);
  } catch (error) {
    refused(error, token, "That message could not be sent.");
  }
  revalidatePath(here(token));
  redirect(`${here(token)}?saved=asked`);
}
