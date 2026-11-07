// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Blog taxonomy and guest-author administration (C2.27/C2.28).
import { notFound } from "next/navigation";
import { authorAccounts, listAuthors, listTerms } from "@/modules/cms/blog-service";
import { Button, Field, Input, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { deleteAuthorAction, deleteTermAction, saveAuthorAction, saveTermAction } from "../actions";

export const dynamic = "force-dynamic";
export default async function BlogDirectory({ params, searchParams }: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ edit?: string; error?: string; saved?: string }>;
}) {
  const { kind } = await params;
  if (!["categories", "tags", "authors"].includes(kind)) notFound();
  const actor = await requireStaffActor("cms", "manage");
  const [t, query] = await Promise.all([getT(), searchParams]);
  const taxonomy = kind === "tags" ? "tag" : "category";
  const terms = kind === "authors" ? [] : await listTerms.call({ taxonomy }, actor);
  const authors = kind === "authors" ? await listAuthors.call({}, actor) : [];
  const accounts = kind === "authors" ? await authorAccounts.call({}, actor) : [];
  const term = terms.find(row => row.id === query.edit);
  const author = authors.find(row => row.id === query.edit);
  const current = author ?? term;
  const seo = (current?.seo ?? {}) as { title?: string; description?: string; noindex?: boolean };
  return <div className="grid max-w-3xl gap-6">
    <a className="underline" href="/admin/blog">{t("blog.title")}</a>
    <h1 className="text-2xl font-semibold">{t(`blog.${kind}`)}</h1>
    {query.error ? <p role="alert">{t("common.somethingWentWrong")}</p> : null}
    {query.saved ? <p role="status">{t("blog.saved")}</p> : null}
    <form action={kind === "authors" ? saveAuthorAction : saveTermAction} className="grid gap-4 rounded-lg border border-rule bg-surface p-6">
      {current ? <input type="hidden" name="id" value={current.id} /> : null}
      <input type="hidden" name="taxonomy" value={taxonomy} />
      <Field label={t("blog.name")} htmlFor="name"><Input id="name" name="name" defaultValue={current?.name} required maxLength={200} /></Field>
      <Field label={t("cms.field.slug")} htmlFor="slug"><Input id="slug" name="slug" defaultValue={current?.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></Field>
      <Field label={t(kind === "authors" ? "blog.bio" : "blog.description")} htmlFor="description"><textarea className="min-h-24 w-full rounded-md border border-rule bg-surface px-3 py-2 text-ink" id="description" name={kind === "authors" ? "bio" : "description"} defaultValue={author?.bio ?? term?.description ?? ""} maxLength={4000} /></Field>
      {kind === "authors" ? <Field label={t("blog.privateEmail")} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="off" defaultValue={author?.email ?? ""} maxLength={320} /></Field> : null}
      {kind === "authors" ? <Field label={t("blog.linkedAccount")} htmlFor="userId"><Select id="userId" name="userId" defaultValue={author?.userId ?? ""}><option value="">{t("blog.guestAuthor")}</option>{author?.userId && !accounts.some(account => account.id === author.userId) ? <option value={author.userId}>{author.name}</option> : null}{accounts.map(account => <option key={account.id} value={account.id}>{account.email}</option>)}</Select></Field> : null}
      {kind === "categories" ? <Field label={t("blog.parent")} htmlFor="parentId"><Select id="parentId" name="parentId" defaultValue={term?.parentId ?? ""}><option value="">{t("blog.none")}</option>{terms.filter(row => row.id !== term?.id).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field> : null}
      <Field label={t("blog.seoTitle")} htmlFor="seoTitle"><Input id="seoTitle" name="seoTitle" defaultValue={seo.title} maxLength={200} /></Field>
      <Field label={t("blog.seoDescription")} htmlFor="seoDescription"><textarea className="min-h-24 w-full rounded-md border border-rule bg-surface px-3 py-2 text-ink" id="seoDescription" name="seoDescription" defaultValue={seo.description} maxLength={320} /></Field>
      <label className="flex items-center gap-2"><input type="checkbox" name="noindex" defaultChecked={seo.noindex} />{t("blog.noindex")}</label>
      <Button type="submit">{t("blog.save")}</Button>
    </form>
    <ul className="grid list-none gap-3 p-0">{[...terms, ...authors].map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
      <a className="underline" href={`/admin/blog/${kind}?edit=${row.id}`}>{row.name}</a><span className="text-sm text-ink-muted">/{row.path}</span>
      <form action={kind === "authors" ? deleteAuthorAction : deleteTermAction}><input type="hidden" name="id" value={row.id} /><input type="hidden" name="taxonomy" value={taxonomy} /><Button type="submit" variant="danger">{t("blog.delete")}</Button></form>
    </li>)}</ul>
    {!current && terms.length + authors.length === 0 ? <p>{t("blog.directoryEmpty")}</p> : null}
  </div>;
}
