// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the blog screens (C2.26–C2.28). Every rule lives in the
// cms services, so the admin, the HTTP API and MCP do the same thing.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPage, ensureDefaults } from "@/modules/cms/service";
import {
  deleteAuthor,
  deleteTerm,
  listAuthors,
  saveAuthor,
  saveTerm,
  setPostMeta,
  updateBlogSettings,
} from "@/modules/cms/blog-service";
import { ServiceError } from "@/core/service";
import { requireStaffActor } from "../guard";
import { currentBusiness } from "@/core/settings/read";
import { ownerFacing } from "../../action-helpers";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, key: string): string | undefined {
  return text(form, key) || undefined;
}

function refused(error: unknown, back: string): never {
  if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  if (typeof error === "object" && error !== null && "digest" in error) throw error;
  const message = error instanceof ServiceError ? ownerFacing(error.message) : "";
  redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(message || "1")}`);
}

export async function createBlogPostAction(form: FormData) {
  const actor = await requireStaffActor("cms", "manage");
  const locale = (await currentBusiness())?.defaultLocale ?? "en";
  const title = text(form, "title");
  const slug = text(form, "slug").toLowerCase();
  if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) redirect("/admin/blog?error=1");
  let id: string;
  try {
    await ensureDefaults.call({ locale }, actor);
    const page = await createPage.call(
      {
        title,
        slug: `blog/${slug}`,
        locale,
        blocks: [
          { id: "post-title", type: "heading", props: { text: title, level: 1 } },
          { id: "post-body", type: "text", props: { body: "" } },
        ],
      },
      actor,
    );
    id = page.id;
    // The writer is the author when they have an author profile.
    const mine =
      actor.kind === "user"
        ? (await listAuthors.call({}, actor)).find((author) => author.userId === actor.userId)
        : undefined;
    await setPostMeta.call({ pageId: page.id, isPost: true, authorId: mine?.id ?? null }, actor);
  } catch (error) {
    refused(error, "/admin/blog");
  }
  redirect(`/admin/pages/${id}`);
}

export async function saveBlogSettingsAction(form: FormData) {
  const actor = await requireStaffActor("cms", "manage");
  try {
    await updateBlogSettings.call(
      {
        categoryBase: optional(form, "categoryBase"),
        tagBase: optional(form, "tagBase"),
        authorBase: optional(form, "authorBase"),
        postsPerPage: Number(text(form, "postsPerPage")) || undefined,
      },
      actor,
    );
  } catch (error) {
    refused(error, "/admin/blog");
  }
  revalidatePath("/admin/blog");
  redirect("/admin/blog?saved=1");
}

export async function saveTermAction(form: FormData) {
  const actor = await requireStaffActor("cms", "manage");
  const taxonomy = text(form, "taxonomy") === "tag" ? "tag" : "category";
  const back = taxonomy === "tag" ? "/admin/blog/tags" : "/admin/blog/categories";
  try {
    await saveTerm.call(
      {
        id: optional(form, "id"),
        taxonomy,
        name: text(form, "name"),
        slug: optional(form, "slug"),
        description: text(form, "description") || null,
        ...(taxonomy === "category" ? { parentId: text(form, "parentId") || null } : {}),
        seo: {
          title: optional(form, "seoTitle"),
          description: optional(form, "seoDescription"),
          noindex: form.get("noindex") === "on",
        },
      },
      actor,
    );
  } catch (error) {
    refused(error, back);
  }
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

export async function deleteTermAction(form: FormData) {
  const actor = await requireStaffActor("cms", "manage");
  const back = text(form, "taxonomy") === "tag" ? "/admin/blog/tags" : "/admin/blog/categories";
  try {
    await deleteTerm.call({ id: text(form, "id") }, actor);
  } catch (error) {
    refused(error, back);
  }
  revalidatePath(back);
  redirect(back);
}

export async function saveAuthorAction(form: FormData) {
  const actor = await requireStaffActor("cms", "manage");
  try {
    await saveAuthor.call(
      {
        id: optional(form, "id"),
        name: text(form, "name"),
        slug: optional(form, "slug"),
        bio: text(form, "bio") || null,
        email: text(form, "email") || null,
        userId: text(form, "userId") || null,
        seo: {
          title: optional(form, "seoTitle"),
          description: optional(form, "seoDescription"),
          noindex: form.get("noindex") === "on",
        },
      },
      actor,
    );
  } catch (error) {
    refused(error, "/admin/blog/authors");
  }
  revalidatePath("/admin/blog/authors");
  redirect("/admin/blog/authors?saved=1");
}

export async function deleteAuthorAction(form: FormData) {
  const actor = await requireStaffActor("cms", "manage");
  try {
    await deleteAuthor.call({ id: text(form, "id") }, actor);
  } catch (error) {
    refused(error, "/admin/blog/authors");
  }
  revalidatePath("/admin/blog/authors");
  redirect("/admin/blog/authors");
}

export async function savePostSettingsAction(form: FormData) {
  const actor = await requireStaffActor("cms", "manage");
  const pageId = text(form, "pageId");
  const back = `/admin/pages/${pageId}`;
  try {
    const isPost = form.get("isPost") === "on";
    await setPostMeta.call(
      isPost
        ? {
            pageId,
            isPost,
            authorId: text(form, "authorId") || null,
            categoryIds: form.getAll("categoryIds").filter((value): value is string => typeof value === "string" && value !== ""),
            tagNames: text(form, "tags")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
            ...(form.has("commentsSetting") ? { commentsEnabled: form.get("commentsEnabled") === "on" } : {}),
          }
        : { pageId, isPost: false },
      actor,
    );
  } catch (error) {
    refused(error, back);
  }
  revalidatePath(back);
  redirect(`${back}?saved=post`);
}
