// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
  createSectionLocale,
  ensureDefaults,
  publishPage,
  restoreRevision,
  updatePage,
  updateSection,
} from "@/modules/cms/service";
import {
  createPreviewLink,
  decideApproval,
  nameRevision,
  requestApproval,
  revokePreviewLink,
  schedulePage,
  snapshotRevision,
} from "@/modules/cms/lifecycle";

export interface SaveResult {
  error?: string;
  version?: number;
  conflict?: boolean;
  path?: string;
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
  if (error instanceof ServiceError) {
    return { error: error.message, conflict: error.code === "conflict" };
  }
  console.error("cms action failed", error);
  return { error: "Something went wrong. Try again." };
}

export async function savePageBlocksAction(
  id: string,
  blocks: unknown,
  expectedVersion?: number,
): Promise<SaveResult> {
  try {
    const page = await updatePage.call(
      { id, blocks, expectedVersion },
      await currentActor(),
    );
    // The public page renders from the database on every request, so the only
    // thing to invalidate is Next's own route cache.
    revalidatePath("/", "layout");
    return { version: page.version };
  } catch (error) {
    return present(error);
  }
}

export async function saveSectionBlocksAction(
  key: string,
  locale: string,
  blocks: unknown,
): Promise<SaveResult> {
  try {
    await updateSection.call({ key, locale, blocks }, await currentActor());
    revalidatePath("/", "layout");
    return {};
  } catch (error) {
    return present(error);
  }
}

export async function createSectionLocaleAction(
  key: string,
  locale: string,
): Promise<void> {
  await createSectionLocale.call({ key, locale }, await currentActor());
  revalidatePath("/", "layout");
  redirect(`/admin/sections/${encodeURIComponent(key)}?locale=${encodeURIComponent(locale)}`);
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

export async function schedulePageAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const publishAt = text(form, "publishAt");
  const unpublishAt = text(form, "unpublishAt");
  await schedulePage.call(
    {
      id,
      publishAt: publishAt === "" ? null : publishAt,
      unpublishAt: unpublishAt === "" ? null : unpublishAt,
    },
    await currentActor(),
  );
  revalidatePath("/", "layout");
}

export async function requestApprovalAction(form: FormData): Promise<void> {
  await requestApproval.call(
    { id: text(form, "id"), note: text(form, "note") || undefined },
    await currentActor(),
  );
  revalidatePath("/", "layout");
}

export async function decideApprovalAction(form: FormData): Promise<void> {
  await decideApproval.call(
    {
      id: text(form, "id"),
      approved: text(form, "approved") === "true",
      note: text(form, "note") || undefined,
    },
    await currentActor(),
  );
  revalidatePath("/", "layout");
}

export async function createPreviewLinkAction(form: FormData): Promise<SaveResult> {
  try {
    const link = await createPreviewLink.call(
      { pageId: text(form, "id") },
      await currentActor(),
    );
    revalidatePath("/", "layout");
    return { path: link.path };
  } catch (error) {
    return present(error);
  }
}

export async function revokePreviewLinkAction(form: FormData): Promise<void> {
  await revokePreviewLink.call({ id: text(form, "linkId") }, await currentActor());
  revalidatePath("/", "layout");
}

export async function snapshotRevisionAction(form: FormData): Promise<void> {
  await snapshotRevision.call(
    { pageId: text(form, "id"), name: text(form, "name") },
    await currentActor(),
  );
  revalidatePath("/", "layout");
}

export async function nameRevisionAction(form: FormData): Promise<void> {
  await nameRevision.call(
    { revisionId: text(form, "revisionId"), name: text(form, "name") },
    await currentActor(),
  );
  revalidatePath("/", "layout");
}

/** Re-create the starting chrome and home page. Idempotent by design. */
export async function ensureDefaultsAction(): Promise<void> {
  await ensureDefaults.call({}, await currentActor());
  revalidatePath("/", "layout");
}
