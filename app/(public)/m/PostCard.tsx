// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.04: one post, with mentions and hashtags as links, reactions, and the
// author's own controls.
import type { ReactNode } from "react";
import { formatDateTime } from "@/core/i18n";
import { Button, Pill } from "@/ui/primitives";
import { createPostAction, deletePostAction, reactAction } from "./post-actions";

const REACTIONS = ["like", "love", "laugh", "wow", "sad", "thanks"] as const;
const SYMBOL: Record<(typeof REACTIONS)[number], string> = { like: "👍", love: "❤️", laugh: "😄", wow: "😮", sad: "😢", thanks: "🙏" };

export type Post = {
  id: string;
  author: { userId: string; handle: string; displayName: string };
  body: string;
  visibility: string;
  adult?: boolean;
  createdAt: Date;
  editedAt: Date | null;
  repost: { id: string; author: { handle: string; displayName: string }; body: string; createdAt: Date } | null;
  reactions: Record<string, number>;
  myReaction: string | null;
  comments: number;
  tagged: { handle: string; displayName: string }[];
};

/** Plain text with @mentions and #hashtags linked. React escapes the rest. */
export function RichText({ body }: { body: string }) {
  const parts: ReactNode[] = [];
  const pattern = /(@[a-z0-9_]{3,30}\b|#[\p{L}\p{N}_]{1,50})/giu;
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(body.slice(last, at));
    const token = match[0];
    parts.push(
      token.startsWith("@") ? (
        <a key={at} className="underline" href={`/@${token.slice(1).toLowerCase()}`}>{token}</a>
      ) : (
        <a key={at} className="underline" href={`/tags/${encodeURIComponent(token.slice(1).toLowerCase())}`}>{token}</a>
      ),
    );
    last = at + token.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <p className="whitespace-pre-line break-words">{parts}</p>;
}

export function PostCard({
  post,
  viewerId,
  back,
  timezone,
  locale,
  labels,
}: {
  post: Post;
  viewerId: string | null;
  back: string;
  timezone: string;
  locale: string;
  labels: { visibility: string; edited: string; comments: string; delete: string; repost: string; report: string; adult: string; reactions: Record<string, string>; reposted: string; with: string };
}) {
  const mine = viewerId === post.author.userId;
  return (
    <article className="grid gap-3 rounded-lg border border-rule bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <a className="font-semibold underline" href={`/@${post.author.handle}`}>{post.author.displayName}</a>
        <span className="text-ink-muted">@{post.author.handle}</span>
        <a className="text-ink-muted underline" href={`/p/${post.id}`}>{formatDateTime(post.createdAt, timezone, locale)}</a>
        {post.editedAt ? <span className="text-ink-muted">{labels.edited}</span> : null}
        <Pill>{labels.visibility}</Pill>
        {post.adult ? <Pill tone="warning">{labels.adult}</Pill> : null}
      </header>
      {post.body ? <RichText body={post.body} /> : null}
      {post.repost ? (
        <blockquote className="grid gap-1 rounded-md border border-rule p-3 text-sm">
          <span className="text-ink-muted">{labels.reposted} <a className="underline" href={`/@${post.repost.author.handle}`}>@{post.repost.author.handle}</a></span>
          <RichText body={post.repost.body} />
        </blockquote>
      ) : null}
      {post.tagged.length ? (
        <p className="text-sm text-ink-muted">
          {labels.with} {post.tagged.map((p, i) => <span key={p.handle}>{i ? ", " : ""}<a className="underline" href={`/@${p.handle}`}>@{p.handle}</a></span>)}
        </p>
      ) : null}
      <footer className="flex flex-wrap items-center gap-2 text-sm">
        {REACTIONS.map((kind) => (
          <form key={kind} action={reactAction}>
            <input type="hidden" name="postId" value={post.id} />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="kind" value={post.myReaction === kind ? "" : kind} />
            <Button type="submit" variant="quiet" aria-pressed={post.myReaction === kind} aria-label={labels.reactions[kind]}>
              <span aria-hidden="true">{SYMBOL[kind]}</span> {post.reactions[kind] ?? 0}
            </Button>
          </form>
        ))}
        <a className="underline" href={`/p/${post.id}`}>{labels.comments}</a>
        {viewerId && !mine && post.visibility === "public" && !post.repost ? (
          <form action={createPostAction}>
            <input type="hidden" name="repostOf" value={post.id} />
            <input type="hidden" name="back" value={back} />
            <Button type="submit" variant="quiet">{labels.repost}</Button>
          </form>
        ) : null}
        {viewerId && !mine ? <a className="text-sm text-ink-muted underline" href={`/report?type=post&id=${post.id}`}>{labels.report}</a> : null}
        {mine ? (
          <form action={deletePostAction}>
            <input type="hidden" name="id" value={post.id} />
            <Button type="submit" variant="danger">{labels.delete}</Button>
          </form>
        ) : null}
      </footer>
    </article>
  );
}

type T = (key: string, values?: Record<string, string | number>) => string;

/** The translated labels a PostCard needs, for one post. */
export function postLabels(t: T, post: Pick<Post, "visibility" | "comments">) {
  return {
    visibility: t(`members.visibility.${post.visibility}`),
    edited: t("members.post.edited"),
    comments: t("members.post.comments", { count: post.comments }),
    delete: t("members.post.delete"),
    repost: t("members.post.repost"),
    report: t("members.report.action"),
    adult: t("members.adult.badge"),
    reposted: t("members.post.reposted"),
    with: t("members.post.with"),
    reactions: Object.fromEntries(REACTIONS.map((k) => [k, t(`members.reaction.${k}`)])),
  };
}
