// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { listReaderCommentsForOwner } from "@/modules/cms/blog-comments";
import { Button, Select } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { moderateReaderCommentAction } from "../actions";
export const dynamic = "force-dynamic";
const states = ["pending", "approved", "spam", "trash"] as const;
export default async function CommentQueue({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; saved?: string; page?: string }> }) {
  const actor = await requireStaffActor("cms", "manage");
  const query = await searchParams;
  const status = states.find(value => value === query.status);
  const page = Math.max(1, Math.min(10000, Math.floor(Number(query.page)) || 1));
  const pageHref = (number: number) => `/admin/blog/comments?page=${number}${status ? `&status=${status}` : ""}`;
  const [t, comments] = await Promise.all([getT(), listReaderCommentsForOwner.call({ status, page }, actor)]);
  return <div className="grid max-w-3xl gap-6"><h1 className="text-2xl font-semibold">{t("blog.comments")}</h1>
    <a className="underline" href="/admin/blog">{t("blog.title")}</a>
    <nav className="flex flex-wrap gap-4" aria-label={t("blog.commentStatus")}><a className="underline" href="/admin/blog/comments">{t("blog.commentAll")}</a>{states.map(value => <a key={value} className="underline" href={`/admin/blog/comments?status=${value}`}>{t(`blog.commentState.${value}`)}</a>)}</nav>
    {query.error ? <p role="alert">{t("common.somethingWentWrong")}</p> : null}{query.saved ? <p role="status">{t("blog.saved")}</p> : null}
    {!comments.length ? <p>{t("blog.commentEmpty")}</p> : null}
    <ul className="grid list-none gap-5 p-0">{comments.map(comment => <li key={comment.id} className="grid gap-3 rounded-lg border border-rule bg-surface p-5"><div className="flex flex-wrap justify-between gap-3"><strong>{comment.authorName}</strong><time dateTime={comment.createdAt.toISOString()}>{comment.createdAt.toLocaleString()}</time></div><p className="whitespace-pre-wrap break-words">{comment.body}</p><a className="underline" href={`/admin/pages/${comment.pageId}`}>{t("blog.commentPost")}</a><form action={moderateReaderCommentAction} className="flex flex-wrap gap-3"><input type="hidden" name="id" value={comment.id} /><Select name="status" defaultValue={comment.status} aria-label={t("blog.commentStatus")}>{states.map(value => <option key={value} value={value}>{t(`blog.commentState.${value}`)}</option>)}</Select><Button type="submit">{t("blog.save")}</Button></form></li>)}</ul>
    {page > 1 || comments.length === 100 ? <nav className="flex justify-between gap-4" aria-label={t("blog.comments")}>{page > 1 ? <a className="underline" href={pageHref(page - 1)}>{t("blog.previous")}</a> : <span />}{comments.length === 100 && page < 10000 ? <a className="underline" href={pageHref(page + 1)}>{t("blog.next")}</a> : null}</nav> : null}
  </div>;
}
