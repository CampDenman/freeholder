// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { redirect } from "next/navigation";
import { createPage, ensureDefaults } from "@/modules/cms/service";
import { requireStaffActor } from "../guard";
import { currentBusiness } from "@/core/settings/read";
export async function createBlogPostAction(form: FormData) {
  const actor = await requireStaffActor("cms", "manage");
  const locale = (await currentBusiness())?.defaultLocale ?? "en";
  const title = (() => { const value=form.get("title"); return typeof value === "string" ? value : ""; })().trim();
  const slug = (() => { const value=form.get("slug"); return typeof value === "string" ? value : ""; })().trim().toLowerCase();
  if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) redirect("/admin/blog?error=1");
  let id: string;
  try {
    await ensureDefaults.call({ locale }, actor);
    const page = await createPage.call({ title, slug: `blog/${slug}`, locale, blocks: [{ id: "post-title", type: "heading", props: { text: title, level: 1 } }, { id: "post-body", type: "text", props: { body: "" } }] }, actor);
    id = page.id;
  } catch { redirect("/admin/blog?error=1"); }
  redirect(`/admin/pages/${id}`);
}
