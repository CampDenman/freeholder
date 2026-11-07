// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { redirect } from "next/navigation";
import { submitReaderComment } from "@/modules/cms/blog-comments";

export async function submitReaderCommentAction(form: FormData) {
  const value = (key: string) => { const field = form.get(key); return typeof field === "string" ? field.trim() : ""; };
  const back = value("returnTo");
  const path = back.startsWith("/") && !back.startsWith("//") && !/[\\\r\n]/.test(back) ? back.split(/[?#]/)[0]! : "/";
  let result = "pending";
  try {
    await submitReaderComment.call({ pageId: value("pageId"), parentId: value("parentId") || null, name: value("name"), email: value("email"), body: value("body"), website: value("website") }, { kind: "anonymous" });
  } catch { result = "error"; }
  redirect(`${path}?comment=${result}#comments`);
}
