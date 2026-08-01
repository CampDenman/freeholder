// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// Editing actions for the cms admin.
//
// Thin, like every other caller: they resolve the actor from the session and
// hand the work to a service (§11). The block tree arrives as JSON from the
// editor and is validated by `cms.updatePage` against the same registry the
// renderer uses — the editor is not trusted just because we wrote it.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  createPage,
  ensureDefaults,
  publishPage,
  restoreRevision,
  updatePage,
  updateSection,
} from "@/modules/cms/service";

export interface SaveResult {
  error?: string;
}

/**
 * A form field as text.
 *
 * FormData yields `string | File | null`, and a field arriving as a File would
 * stringify to "[object File]" — so the type is checked rather than coerced.
 * The same helper exists in the setup and admin actions for the same reason.
 */
function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function currentActor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * Turn a refusal into something the editor can show.
 *
 * Autosave has nowhere to throw to — there is no form submission to fail — so
 * a rejected save has to come back as a value the component can render beside
 * the block that caused it.
 */
function present(error: unknown): SaveResult {
  if (error instanceof ServiceError) return { error: error.message };
  console.error("cms action failed", error);
  return { error: "Something went wrong. Try again." };
}

export async function savePageBlocksAction(
  id: string,
  blocks: unknown,
): Promise<SaveResult> {
  try {
    await updatePage.call({ id, blocks }, await currentActor());
    // The public page renders from the database on every request, so the only
    // thing to invalidate is Next's own route cache.
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return present(error);
  }
}

export async function saveSectionBlocksAction(
  key: string,
  blocks: unknown,
): Promise<SaveResult> {
  try {
    await updateSection.call({ key, blocks }, await currentActor());
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return present(error);
  }
}

export async function savePageDetailsAction(
  _previous: SaveResult,
  form: FormData,
): Promise<SaveResult> {
  const id = text(form, "id");
  const title = text(form, "title");
  const slug = text(form, "slug");
  try {
    await updatePage.call({ id, title, slug }, await currentActor());
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return present(error);
  }
}

export async function createPageAction(
  _previous: SaveResult,
  form: FormData,
): Promise<SaveResult> {
  const title = text(form, "title");
  const slug = text(form, "slug");
  let id: string;
  try {
    const page = await createPage.call({ title, slug }, await currentActor());
    id = page.id;
  } catch (error) {
    return present(error);
  }
  // Outside the try: redirect() signals by throwing, and catching it here
  // would turn a successful create into "something went wrong".
  redirect(`/admin/pages/${id}`);
}

export async function setPagePublishedAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const published = text(form, "published") === "true";
  await publishPage.call({ id, published }, await currentActor());
  revalidatePath("/", "layout");
}

export async function restoreRevisionAction(form: FormData): Promise<void> {
  const revisionId = text(form, "revisionId");
  await restoreRevision.call({ revisionId }, await currentActor());
  revalidatePath("/", "layout");
}

/** Re-create the starting chrome and home page. Idempotent by design. */
export async function ensureDefaultsAction(): Promise<void> {
  await ensureDefaults.call({}, await currentActor());
  revalidatePath("/", "layout");
}
