// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.04: public posts with one hashtag, newest first.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { currentBusiness } from "@/core/settings/read";
import { latestPublic } from "@/modules/members/posts";
import { getLocale, getT } from "../../../i18n";
import { PostCard, postLabels } from "../../m/PostCard";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  return { title: `#${decodeURIComponent((await params).tag)}` };
}

export default async function TagPage({ params, searchParams }: { params: Promise<{ tag: string }>; searchParams: Promise<{ before?: string }> }) {
  const [{ tag: raw }, query, t, locale, business, jar] = await Promise.all([params, searchParams, getT(), getLocale(), currentBusiness(), cookies()]);
  const tag = decodeURIComponent(raw).toLowerCase().slice(0, 50);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const page = await latestPublic.call({ tag, before: query.before }, actor);
  const viewerId = actor.kind === "user" ? actor.userId : null;
  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">#{tag}</h1>
      <p className="text-sm text-ink-muted">{t("members.feed.tagExplain")}</p>
      {page.posts.length === 0 ? <p className="text-ink-muted">{t("members.feed.empty")}</p> : null}
      {page.posts.map((post) => (
        <PostCard key={post.id} post={post} viewerId={viewerId} back="/feed" timezone={business?.timezone ?? "UTC"} locale={locale} labels={postLabels(t, post)} />
      ))}
      {page.next ? <a className="underline" href={`/tags/${encodeURIComponent(tag)}?before=${encodeURIComponent(page.next)}`}>{t("members.feed.older")}</a> : null}
    </div>
  );
}
