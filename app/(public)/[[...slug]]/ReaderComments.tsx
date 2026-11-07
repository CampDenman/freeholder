// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { listReaderComments } from "@/modules/cms/blog-comments";
import { blogSettingsCached } from "@/modules/cms/read";
import type { Translate } from "@/core/i18n";
import { Button, Field, Input, Select } from "@/ui/primitives";
import { submitReaderCommentAction } from "./comment-actions";

export async function ReaderComments({ pageId, enabled, returnTo, result, locale, t, pageValue }: { pageId: string; enabled: boolean; returnTo: string; result?: string; locale: string; t: Translate; pageValue?: string }) {
  const page = Math.max(1, Math.min(10000, Math.floor(Number(pageValue)) || 1));
  const [comments, settings] = await Promise.all([listReaderComments.call({ pageId, page }, { kind: "anonymous" }), blogSettingsCached()]);
  const open = enabled && settings.commentsEnabled;
  if (!open && !comments.length && page === 1) return null;
  return <section id="comments" className="grid gap-5 border-t border-rule pt-6" aria-labelledby="comments-title"><h2 id="comments-title" className="text-xl font-semibold">{t("blog.comments")}</h2>
    {result === "pending" ? <p role="status">{t("blog.commentReceived")}</p> : result === "error" ? <p role="alert">{t("blog.commentFailed")}</p> : null}
    <ol className="grid list-none gap-5 p-0">{comments.map(comment => <li id={`comment-${comment.id}`} key={comment.id} className="grid gap-2 rounded-lg border border-rule p-4"><p className="flex flex-wrap justify-between gap-3"><strong>{comment.authorName}</strong><time dateTime={comment.createdAt.toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(comment.createdAt)}</time></p>{comment.parentId && comments.some(parent => parent.id === comment.parentId) ? <a className="text-sm underline" href={`#comment-${comment.parentId}`}>{t("blog.commentInReplyTo")}</a> : null}<p className="whitespace-pre-wrap break-words">{comment.body}</p></li>)}</ol>
    {page > 1 || comments.length === 100 ? <nav className="flex justify-between gap-4" aria-label={t("blog.comments")}>{page > 1 ? <a className="underline" href={`${returnTo}?commentPage=${page - 1}#comments`}>{t("blog.previous")}</a> : <span />}{comments.length === 100 && page < 10000 ? <a className="underline" href={`${returnTo}?commentPage=${page + 1}#comments`}>{t("blog.next")}</a> : null}</nav> : null}
    {open ? <form action={submitReaderCommentAction} className="grid max-w-xl gap-4"><input type="hidden" name="pageId" value={pageId} /><input type="hidden" name="returnTo" value={returnTo} /><h3 className="text-lg font-semibold">{t("blog.commentLeave")}</h3><p className="text-sm text-ink-muted">{t("blog.commentPrivacy")}</p>
      <Field label={t("blog.name")} htmlFor="comment-name"><Input id="comment-name" name="name" autoComplete="name" required maxLength={200} /></Field><Field label={t("blog.commentEmail")} htmlFor="comment-email"><Input id="comment-email" name="email" type="email" autoComplete="email" required maxLength={320} /></Field>
      {comments.length ? <Field label={t("blog.commentReply")} htmlFor="comment-parent"><Select id="comment-parent" name="parentId"><option value="">{t("blog.none")}</option>{comments.map(comment => <option key={comment.id} value={comment.id}>{comment.authorName}: {comment.body.slice(0, 70)}</option>)}</Select></Field> : null}
      <Field label={t("blog.commentBody")} htmlFor="comment-body"><textarea id="comment-body" name="body" required maxLength={10000} rows={5} className="w-full rounded-md border border-rule bg-surface px-3 py-2 text-ink" /></Field>
      <div hidden aria-hidden="true"><label htmlFor="comment-website">{t("blog.commentWebsite")}</label><input id="comment-website" name="website" tabIndex={-1} autoComplete="off" /></div><Button type="submit">{t("blog.commentSubmit")}</Button>
    </form> : <p>{t("blog.commentClosed")}</p>}
  </section>;
}
