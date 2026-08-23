// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for notes (C7.03). The revision on edit, the visibility filter
// and the mention notifications all live in `core/notes`, so a note written in
// the browser and one written over the API leave the same evidence behind.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  editNote,
  NOTE_SUBJECTS,
  NOTE_VISIBILITIES,
  pinNote,
  removeNote,
  writeNote,
} from "@/core/notes/service";
import { ownerFacing } from "./action-helpers";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** A posted string, only if it is one of the values the service accepts. */
function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return values.find((allowed) => allowed === value) ?? null;
}

/**
 * Where to send the person back to.
 *
 * A note panel sits on a dozen different screens, so the form carries the path
 * it was posted from rather than this file holding a map of every page that
 * might ever host one. Anything that is not an internal path is refused, so a
 * crafted form cannot use the redirect to send somebody off the site.
 */
function backTo(form: FormData): string {
  const value = text(form, "returnTo");
  return /^\/(?!\/)[\w\-/[\]().]*$/.test(value) ? value : "/admin/contacts";
}

function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function writeNoteAction(form: FormData): Promise<void> {
  const path = backTo(form);
  try {
    const subjectType = oneOf(NOTE_SUBJECTS, text(form, "subjectType"));
    if (!subjectType) throw new ServiceError("validation", "Say what this is about.");
    await writeNote.call(
      {
        subjectType,
        subjectId: text(form, "subjectId"),
        body: text(form, "body"),
        visibility: oneOf(NOTE_VISIBILITIES, text(form, "visibility")) ?? "team",
        pinned: text(form, "pinned") === "on",
        mentions: form
          .getAll("mentions")
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That note could not be saved.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=note`);
}

export async function editNoteAction(form: FormData): Promise<void> {
  const path = backTo(form);
  try {
    await editNote.call({ id: text(form, "id"), body: text(form, "body") }, await actor());
  } catch (error) {
    refused(error, path, "That note could not be changed.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=note`);
}

export async function pinNoteAction(form: FormData): Promise<void> {
  const path = backTo(form);
  try {
    await pinNote.call(
      { id: text(form, "id"), pinned: text(form, "pinned") === "on" },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That could not be pinned.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=note`);
}

export async function removeNoteAction(form: FormData): Promise<void> {
  const path = backTo(form);
  try {
    await removeNote.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, path, "That note could not be removed.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=note`);
}
