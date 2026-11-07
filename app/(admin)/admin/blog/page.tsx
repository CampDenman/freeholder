// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { getBlogSettings, listPostPages } from "@/modules/cms/blog-service";
import { Button, Field, Input } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { createBlogPostAction, saveBlogSettingsAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function BlogAdmin({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const actor = await requireStaffActor("cms", "manage");
  const [t, rows, settings, query] = await Promise.all([getT(), listPostPages.call({}, actor), getBlogSettings.call({}, actor), searchParams]);
  return <div className="grid max-w-3xl gap-6">
    <h1 className="text-2xl font-semibold">{t("blog.title")}</h1><p>{t("blog.adminIntro")}</p>
    <nav className="flex flex-wrap gap-4" aria-label={t("blog.title")}><a className="underline" href="/blog">{t("blog.view")}</a>{["categories", "tags", "authors", "comments"].map(kind => <a key={kind} className="underline" href={`/admin/blog/${kind}`}>{t(`blog.${kind}`)}</a>)}</nav>
    {query.error ? <p role="alert">{t("common.somethingWentWrong")}</p> : null}
    {query.saved ? <p role="status">{t("blog.saved")}</p> : null}
    <form action={createBlogPostAction} className="grid gap-4 rounded-lg border border-rule bg-surface p-6">
      <Field label={t("cms.field.pageTitle")} htmlFor="title"><Input id="title" name="title" required maxLength={200} /></Field>
      <Field label={t("cms.field.slug")} htmlFor="slug" hint={t("blog.slugHint")}><Input id="slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={160} /></Field>
      <Button type="submit">{t("blog.create")}</Button>
    </form>
    <ul className="grid list-none gap-3 p-0">{rows.map(p => <li key={p.id} className="flex justify-between gap-4 border-b border-rule pb-3"><a className="underline" href={`/admin/pages/${p.id}`}>{p.title}</a><span>{t(`cms.status.${p.status}`)}</span></li>)}</ul>
    <section><h2 className="text-lg font-semibold">{t("blog.settings")}</h2><form action={saveBlogSettingsAction} className="mt-4 grid gap-4">
      {(["categoryBase", "tagBase", "authorBase"] as const).map(key => <Field key={key} label={t(`blog.${key}`)} htmlFor={key}><Input id={key} name={key} defaultValue={settings[key]} required /></Field>)}
      <Field label={t("blog.postsPerPage")} htmlFor="postsPerPage"><Input id="postsPerPage" name="postsPerPage" type="number" min={1} max={50} defaultValue={settings.postsPerPage} required /></Field>
      <label className="flex gap-2"><input type="checkbox" name="commentsEnabled" defaultChecked={settings.commentsEnabled} />{t("blog.commentsEnabled")}</label><Button type="submit">{t("blog.save")}</Button>
    </form></section>
  </div>;
}
