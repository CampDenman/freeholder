// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// Media actions for the admin. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { deleteAsset, setAltText } from "@/core/media/service";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Delete a file and every rendition of it.
 *
 * Owner-only at the service, and the button is hidden from staff rather than
 * shown and refused — the same choice the contact merge panel makes.
 */
export async function deleteAssetAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  await deleteAsset.call({ id: text(form, "id") }, actor);
  revalidatePath("/", "layout");
}

export async function setAltTextAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  await setAltText.call(
    { id: text(form, "id"), altText: text(form, "altText") },
    actor,
  );
  // Alt text is rendered on the public surface, so the whole tree revalidates.
  revalidatePath("/", "layout");
}
