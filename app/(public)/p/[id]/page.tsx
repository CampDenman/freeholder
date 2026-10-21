// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.04: one post with its threaded comments.
import type { Metadata } from "next";
import { Attachments, MediaAttach } from "../../m/MediaAttach";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime } from "@/core/i18n";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { viewPost } from "@/modules/members/posts";
import { myMembership } from "@/modules/members/service";
import { Button, Callout, Field } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { PostCard, RichText, postLabels } from "../../m/PostCard";
import { commentAction, deleteCommentAction } from "../../m/post-actions";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  try {
    return { actor, view: await viewPost.call({ id }, actor) };
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { view } = await load((await params).id);
  return {
    title: `${view.post.author.displayName}: ${view.post.body.slice(0, 60) || "…"}`,
    robots: view.post.visibility === "public" ? undefined : { index: false, follow: false },
  };
}

export default async function PostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, query, t, locale, business] = await Promise.all([params, searchParams, getT(), getLocale(), currentBusiness()]);
  const { actor, view } = await load(id);
  const me = actor.kind === "user" ? await myMembership.call({}, actor) : null;
  const viewerId = actor.kind === "user" ? actor.userId : null;
  const timezone = business?.timezone ?? "UTC";
  const back = `/p/${view.post.id}`;
  const top = view.comments.filter((c) => !c.parentId);
  const replies = (parentId: string) => view.comments.filter((c) => c.parentId === parentId);
  const Comment = ({ c }: { c: (typeof view.comments)[number] }) => (
    <li className="grid gap-2 rounded-md border border-rule p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <a className="font-semibold underline" href={`/@${c.author.handle}`}>{c.author.displayName}</a>
        <span className="text-ink-muted">{formatDateTime(c.createdAt, timezone, locale)}</span>
        {c.restricted ? <span className="text-ink-muted">{t("members.post.restrictedNote")}</span> : null}
      </p>
      <RichText body={c.body} />
      <Attachments items={c.attachments} />
      <div className="flex flex-wrap gap-2">
        {viewerId && (viewerId === c.author.userId || viewerId === view.post.author.userId) ? (
          <form action={deleteCommentAction}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="back" value={back} />
            <Button type="submit" variant="quiet">{t("members.post.deleteComment")}</Button>
          </form>
        ) : null}
        {viewerId && viewerId !== c.author.userId ? <a className="text-sm text-ink-muted underline" href={`/report?type=comment&id=${c.id}`}>{t("members.report.action")}</a> : null}
      </div>
      {replies(c.id).length ? <ul className="grid gap-2 ps-4">{replies(c.id).map((r) => <Comment key={r.id} c={r} />)}</ul> : null}
      {me?.status === "active" && !c.parentId ? (
        <form action={commentAction} className="grid gap-2 ps-4">
          <input type="hidden" name="postId" value={view.post.id} />
          <input type="hidden" name="parentId" value={c.id} />
          <input type="hidden" name="back" value={back} />
          <Field label={t("members.post.reply")} htmlFor={`reply-${c.id}`}>
            <textarea id={`reply-${c.id}`} name="body" required maxLength={2000} rows={2} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
          </Field>
          <Button type="submit" variant="quiet">{t("members.post.sendReply")}</Button>
        </form>
      ) : null}
    </li>
  );
  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <h1 className="sr-only">{t("members.post.title", { name: view.post.author.displayName })}</h1>
      {query.error ? <Callout tone="danger">{t("members.post.failed")}</Callout> : null}
      <PostCard post={view.post} viewerId={viewerId} back={back} timezone={timezone} locale={locale} labels={postLabels(t, view.post)} />
      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">{t("members.post.comments", { count: view.comments.length })}</h2>
        {me?.status === "active" ? (
          <form action={commentAction} className="grid gap-2">
            <input type="hidden" name="postId" value={view.post.id} />
            <input type="hidden" name="back" value={back} />
            <Field label={t("members.post.addComment")} htmlFor="comment-body">
              <textarea id="comment-body" name="body" required maxLength={2000} rows={2} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
            </Field>
            <MediaAttach id="comment" labels={{ add: t("members.attach.add"), describe: t("members.attach.describe"), uploading: t("members.avatar.uploading"), failed: t("members.avatar.failed"), remove: t("members.attach.remove") }} />
            <Button type="submit">{t("members.post.sendComment")}</Button>
          </form>
        ) : null}
        <ul className="grid gap-3">{top.map((c) => <Comment key={c.id} c={c} />)}</ul>
      </section>
    </div>
  );
}
