// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Actor } from "@/core/service";
import { getPostMeta, listAuthors, listTerms } from "@/modules/cms/blog-service";
import { Button, Field, Input, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { savePostSettingsAction } from "./actions";

export async function BlogPostSettings({ pageId, actor }: { pageId: string; actor: Actor }) {
  const [meta, authors, terms, t] = await Promise.all([
    getPostMeta.call({ pageId }, actor), listAuthors.call({}, actor), listTerms.call({}, actor), getT(),
  ]);
  return <section className="rounded-lg border border-rule bg-surface p-6" aria-labelledby="post-settings-title">
    <h2 id="post-settings-title" className="text-lg font-semibold">{t("blog.postSettings")}</h2>
    <form action={savePostSettingsAction} className="mt-4 grid gap-4">
      <input type="hidden" name="pageId" value={pageId} />
      <label className="flex items-center gap-2"><input type="checkbox" name="isPost" defaultChecked={meta.isPost} />{t("blog.isPost")}</label>
      <Field label={t("blog.author")} htmlFor="post-author"><Select id="post-author" name="authorId" defaultValue={meta.authorId ?? ""}><option value="">{t("blog.none")}</option>{authors.map(author => <option key={author.id} value={author.id}>{author.name}</option>)}</Select></Field>
      <fieldset><legend>{t("blog.categories")}</legend>{terms.filter(term => term.taxonomy === "category").map(term => <label key={term.id} className="mt-2 flex items-center gap-2"><input type="checkbox" name="categoryIds" value={term.id} defaultChecked={meta.categoryIds.includes(term.id)} />{term.name}</label>)}</fieldset>
      <Field label={t("blog.tags")} htmlFor="post-tags"><Input id="post-tags" name="tags" defaultValue={terms.filter(term => meta.tagIds.includes(term.id)).map(term => term.name).join(", ")} /></Field>
      <input type="hidden" name="commentsSetting" value="1" />
      <label className="flex items-center gap-2"><input type="checkbox" name="commentsEnabled" defaultChecked={meta.commentsEnabled} />{t("blog.commentsEnabled")}</label>
      <Button type="submit">{t("blog.save")}</Button>
    </form>
  </section>;
}
