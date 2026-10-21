// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.04 (MASTER.md §44.2, §44.4): the home feed — people you follow and your
// friends, newest first — and the plainly labelled latest public posts.
import type { Metadata } from "next";
import { MediaAttach } from "../m/MediaAttach";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { currentBusiness } from "@/core/settings/read";
import { homeFeed, latestPublic, pendingTags } from "@/modules/members/posts";
import { remoteFeed } from "@/modules/members/federation/following";
import { formatDateTime } from "@/core/i18n";
import { membershipRules, myMembership } from "@/modules/members/service";
import { VISIBILITIES } from "@/modules/members/visibility";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../i18n";
import { PostCard, postLabels } from "../m/PostCard";
import { answerTagAction, createPostAction } from "../m/post-actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.feed.title"), robots: { index: false, follow: false } };
}

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ view?: string; before?: string; error?: string }> }) {
  const [t, locale, business, jar, query] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies(), searchParams]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const [me, rules] = await Promise.all([actor.kind === "user" ? myMembership.call({}, actor) : null, membershipRules.call({}, actor)]);
  const latest = query.view === "latest" || !me || me.status !== "active";
  const page = latest ? await latestPublic.call({ before: query.before }, actor) : await homeFeed.call({ before: query.before }, actor);
  const tags = me?.status === "active" ? await pendingTags.call({}, actor) : [];
  // C12.32: posts from fediverse accounts the member follows, in the same window of time as this page.
  const before = query.before?.split("|")[0];
  const oldest = page.next ? page.posts.at(-1)?.createdAt : undefined;
  const elsewhere = latest ? [] : (await remoteFeed.call({ before: before ? new Date(before) : undefined, after: oldest }, actor)).posts;
  const items = [
    ...page.posts.map((post) => ({ at: new Date(post.createdAt).getTime(), post, remote: null })),
    ...elsewhere.map((remote) => ({ at: new Date(remote.publishedAt).getTime(), post: null, remote })),
  ].sort((a, b) => b.at - a.at);
  const timezone = business?.timezone ?? "UTC";
  const viewerId = actor.kind === "user" ? actor.userId : null;
  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">{t("members.feed.title")}</h1>
      <nav aria-label={t("members.feed.views")} className="flex gap-4">
        {me?.status === "active" ? <a className="underline" href="/feed" aria-current={latest ? undefined : "page"}>{t("members.feed.following")}</a> : null}
        <a className="underline" href="/feed?view=latest" aria-current={latest ? "page" : undefined}>{t("members.feed.latest")}</a>
      </nav>
      <p className="text-sm text-ink-muted">{t(latest ? "members.feed.latestExplain" : "members.feed.followingExplain")}</p>
      {query.error ? <Callout tone="danger">{t("members.post.failed")}</Callout> : null}
      {!me ? <a className="underline" href="/join">{t("members.graph.joinToConnect")}</a> : null}
      {me?.status === "active" ? (
        <form action={createPostAction} className="grid gap-3 rounded-lg border border-rule bg-surface p-4">
          <input type="hidden" name="back" value="/feed" />
          <Field label={t("members.post.body")} htmlFor="post-body">
            <textarea id="post-body" name="body" maxLength={5000} rows={3} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
          </Field>
          <MediaAttach id="post" labels={{ add: t("members.attach.add"), describe: t("members.attach.describe"), uploading: t("members.avatar.uploading"), failed: t("members.avatar.failed"), remove: t("members.attach.remove") }} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("members.post.visibility")} htmlFor="post-visibility">
              <Select id="post-visibility" name="visibility" defaultValue={me.defaultPostVisibility}>
                {VISIBILITIES.map((v) => <option key={v} value={v}>{t(`members.visibility.${v}`)}</option>)}
              </Select>
            </Field>
            <Field label={t("members.post.tagPeople")} htmlFor="post-tag" hint={t("members.post.tagHint")}>
              <Input id="post-tag" name="tag" maxLength={300} />
            </Field>
          </div>
          {rules.adultContent && me.isAdult ? (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="adult" value="yes" />
              <span>{t("members.adult.markPost")}</span>
            </label>
          ) : null}
          <Button type="submit">{t("members.post.publish")}</Button>
        </form>
      ) : null}
      {tags.length ? (
        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">{t("members.post.tagRequests")}</h2>
          {tags.map(({ mentionId, post }) => (
            <div key={mentionId} className="grid gap-2">
              <PostCard post={post} viewerId={viewerId} back="/feed" timezone={timezone} locale={locale} labels={postLabels(t, post)} />
              <form action={answerTagAction} className="flex gap-2">
                <input type="hidden" name="mentionId" value={mentionId} />
                <input type="hidden" name="back" value="/feed" />
                <Button type="submit" name="approve" value="yes">{t("members.post.approveTag")}</Button>
                <Button type="submit" name="approve" value="no" variant="quiet">{t("members.post.declineTag")}</Button>
              </form>
            </div>
          ))}
        </section>
      ) : null}
      <section className="grid gap-4" aria-label={t("members.feed.posts")}>
        {items.length === 0 ? <p className="text-ink-muted">{t("members.feed.empty")}</p> : null}
        {items.map(({ post, remote }) =>
          post ? (
            <PostCard key={post.id} post={post} viewerId={viewerId} back="/feed" timezone={timezone} locale={locale} labels={postLabels(t, post)} />
          ) : remote ? (
            <article key={remote.id} className="grid gap-2 rounded-lg border border-rule bg-surface p-4" data-remote-post>
              <p className="text-sm text-ink-muted">@{remote.handle} · {formatDateTime(remote.publishedAt, timezone, locale)} · {t("members.fediverse.elsewhere")}</p>
              <p className="whitespace-pre-line break-words">{remote.text}</p>
              {remote.url ? <p><a className="text-sm underline" href={remote.url} rel="nofollow noopener noreferrer">{t("members.fediverse.original")}</a></p> : null}
            </article>
          ) : null,
        )}
      </section>
      {page.next ? <a className="underline" href={`/feed?${latest ? "view=latest&" : ""}before=${encodeURIComponent(page.next)}`}>{t("members.feed.older")}</a> : null}
    </div>
  );
}
