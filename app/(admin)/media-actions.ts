// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// Media actions for the admin. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import {
  acceptAltTextSuggestion,
  dismissAltTextSuggestion,
  generateAltTextSuggestion,
  purgeAsset,
  rescanAsset,
  restoreAsset,
  setAltText,
  setFocalPoint,
  trashAsset,
  updateAssetDetails,
} from "@/core/media/service";
import { ServiceError } from "@/core/service";
import { getT } from "../i18n";

export interface MediaActionState {
  error?: string;
  saved?: boolean;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Move a file and every rendition into recoverable trash.
 *
 * Owner-only at the service, and the button is hidden from staff rather than
 * shown and refused — the same choice the contact merge panel makes.
 */
export async function deleteAssetAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  await trashAsset.call({ id: text(form, "id") }, actor);
  revalidatePath("/", "layout");
}

export async function restoreAssetAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  await restoreAsset.call({ id: text(form, "id") }, actor);
  revalidatePath("/", "layout");
}

export async function purgeAssetAction(
  _previous: MediaActionState,
  form: FormData,
): Promise<MediaActionState> {
  try {
    const actor = await actorFromToken(
      (await cookies()).get(SESSION_COOKIE)?.value,
    );
    await purgeAsset.call(
      { id: text(form, "id"), confirmation: text(form, "confirmation") },
      actor,
    );
    revalidatePath("/", "layout");
    return { saved: true };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("media purge failed", error);
    const t = await getT();
    return { error: t("media.purgeFailed") };
  }
}

export async function rescanAssetAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  await rescanAsset.call({ id: text(form, "id") }, actor);
  revalidatePath("/", "layout");
}

export async function setFocalPointAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  await setFocalPoint.call(
    {
      id: text(form, "id"),
      x: Number(text(form, "x")),
      y: Number(text(form, "y")),
    },
    actor,
  );
  revalidatePath("/", "layout");
}

export async function updateAssetDetailsAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  const optionalNumber = (key: string) => {
    const value = text(form, key);
    return value ? Number(value) : undefined;
  };
  await updateAssetDetails.call(
    {
      id: text(form, "id"),
      metadata: {
        width: optionalNumber("width"),
        height: optionalNumber("height"),
        durationSeconds: optionalNumber("durationSeconds"),
        pageCount: optionalNumber("pageCount"),
        codec: text(form, "codec") || undefined,
      },
      provenance: {
        sourceUrl: text(form, "sourceUrl") || undefined,
        capturedAt: text(form, "capturedAt")
          ? new Date(text(form, "capturedAt")).toISOString()
          : undefined,
        note: text(form, "note") || undefined,
      },
    },
    actor,
  );
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

async function suggestionAction(
  operation: () => Promise<unknown>,
): Promise<MediaActionState> {
  try {
    await operation();
    revalidatePath("/", "layout");
    return { saved: true };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("alt-text suggestion action failed", error);
    const t = await getT();
    return { error: t("media.altSuggestionFailed") };
  }
}

export async function generateAltTextSuggestionAction(
  _previous: MediaActionState,
  form: FormData,
): Promise<MediaActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  return suggestionAction(() =>
    generateAltTextSuggestion.call({ id: text(form, "id") }, actor),
  );
}

export async function acceptAltTextSuggestionAction(
  _previous: MediaActionState,
  form: FormData,
): Promise<MediaActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  return suggestionAction(() =>
    acceptAltTextSuggestion.call(
      {
        id: text(form, "id"),
        suggestionId: text(form, "suggestionId"),
        altText: text(form, "altText"),
      },
      actor,
    ),
  );
}

export async function dismissAltTextSuggestionAction(
  _previous: MediaActionState,
  form: FormData,
): Promise<MediaActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  return suggestionAction(() =>
    dismissAltTextSuggestion.call(
      { id: text(form, "id"), suggestionId: text(form, "suggestionId") },
      actor,
    ),
  );
}
