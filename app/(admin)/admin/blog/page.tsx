// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { listPages } from "@/modules/cms/service";
import { Button, Field, Input } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { createBlogPostAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function BlogAdmin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requireStaffActor("cms", "manage");
  const [t, rows, query] = await Promise.all([getT(), listPages.call({}, actor), searchParams]);
  return <div className="grid max-w-3xl gap-6"><h1 className="text-2xl font-semibold">{t("blog.title")}</h1><p>{t("blog.adminIntro")}</p><a className="underline" href="/blog">{t("blog.view")}</a>{query.error ? <p role="alert">{t("common.somethingWentWrong")}</p> : null}<form action={createBlogPostAction} className="grid gap-4 rounded-lg border border-rule bg-surface p-6"><Field label={t("cms.field.pageTitle")} htmlFor="title"><Input id="title" name="title" required maxLength={200} /></Field><Field label={t("cms.field.slug")} htmlFor="slug" hint={t("blog.slugHint")}><Input id="slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={160} /></Field><Button type="submit">{t("blog.create")}</Button></form><ul className="grid list-none gap-3 p-0">{rows.filter(p=>p.slug.startsWith("blog/")).map(p=><li key={p.id} className="flex justify-between gap-4 border-b border-rule pb-3"><a className="underline" href={`/admin/pages/${p.id}`}>{p.title}</a><span>{t(`cms.status.${p.status}`)}</span></li>)}</ul></div>;
}
