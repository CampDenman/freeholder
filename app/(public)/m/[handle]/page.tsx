// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.02 (MASTER.md §44.3): a member's profile, as this viewer may see it.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { viewProfile } from "@/modules/members/graph";
import { postsBy } from "@/modules/members/posts";
import { storefront } from "@/modules/members/listings";
import { reviewsFor } from "@/modules/members/reputation";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { myMembership } from "@/modules/members/service";
import { Button, Callout, Pill } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { PostCard, postLabels } from "../PostCard";
import { memberGraphAction } from "../actions";
import { startCallAction } from "../../call/actions";

export const dynamic = "force-dynamic";

async function load(handle: string) {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    return { actor, profile: await viewProfile.call({ handle }, actor) };
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { profile } = await load((await params).handle);
  return {
    title: `${profile.displayName} (@${profile.handle})`,
    robots: profile.indexable ? undefined : { index: false, follow: false },
  };
}

function Verb({ handle, verb, label, variant }: { handle: string; verb: string; label: string; variant?: "quiet" | "danger" }) {
  return (
    <form action={memberGraphAction}>
      <input type="hidden" name="handle" value={handle} />
      <input type="hidden" name="verb" value={verb} />
      <Button type="submit" variant={variant}>{label}</Button>
    </form>
  );
}

export default async function MemberProfile({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const [{ handle }, query, t, locale, business] = await Promise.all([params, searchParams, getT(), getLocale(), currentBusiness()]);
  const { actor, profile } = await load(handle);
  const r = profile.relation;
  const [posts, shop, reviews] = await Promise.all([
    postsBy.call({ handle: profile.handle }, actor),
    storefront.call({ handle: profile.handle }, actor),
    r.blocked ? null : reviewsFor.call({ handle: profile.handle }, actor),
  ]);
  const viewer = actor.kind === "user" ? await myMembership.call({}, actor) : null;
  const canAct = viewer?.status === "active" && !r.self;
  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold">{profile.displayName}</h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-muted">
          <span>@{profile.handle}</span>
          {profile.isPrivate ? <Pill>{t("members.profile.private")}</Pill> : null}
          {r.followsYou ? <Pill>{t("members.graph.followsYou")}</Pill> : null}
          {r.friend === "friends" && !r.self ? <Pill tone="success">{t("members.graph.friends")}</Pill> : null}
        </p>
        <p className="text-sm">
          {t("members.graph.counts", { followers: profile.followers, following: profile.following, friends: profile.friends })}
        </p>
      </header>
      {query.error ? <Callout tone="danger">{t(query.error === "conflict" ? "members.calls.busy" : "members.graph.failed")}</Callout> : null}
      {r.blocked ? (
        <Callout>{t("members.graph.youBlocked")}</Callout>
      ) : (
        <>
          {profile.bio !== null ? <p className="whitespace-pre-line">{profile.bio}</p> : null}
          {profile.links?.length ? (
            <ul className="grid gap-1">
              {profile.links.map((link) => (
                <li key={link.url}><a className="underline" href={link.url} rel="nofollow noopener ugc">{link.label}</a></li>
              ))}
            </ul>
          ) : null}
          {profile.bio === null && profile.links === null && !r.self ? <p className="text-ink-muted">{t("members.profile.hidden")}</p> : null}
        </>
      )}
      {r.self ? <a className="underline" href="/portal/member">{t("members.profile.edit")}</a> : null}
      {canAct ? (
        <div className="flex flex-wrap gap-3">
          {r.youBlocked ? (
            <Verb handle={profile.handle} verb="unblock" label={t("members.graph.unblock")} />
          ) : (
            <>
              {r.following === "none" ? <Verb handle={profile.handle} verb="follow" label={t(profile.isPrivate ? "members.graph.requestFollow" : "members.graph.follow")} /> : null}
              {r.following === "requested" ? <Verb handle={profile.handle} verb="unfollow" label={t("members.graph.cancelRequest")} variant="quiet" /> : null}
              {r.following === "active" ? <Verb handle={profile.handle} verb="unfollow" label={t("members.graph.unfollow")} variant="quiet" /> : null}
              {r.friend === "none" ? <Verb handle={profile.handle} verb="befriend" label={t("members.graph.addFriend")} /> : null}
              {r.friend === "they_asked" ? <Verb handle={profile.handle} verb="befriend" label={t("members.graph.acceptFriend")} /> : null}
              {r.friend === "you_asked" ? <Verb handle={profile.handle} verb="unfriend" label={t("members.graph.cancelFriend")} variant="quiet" /> : null}
              {r.friend === "friends" ? <Verb handle={profile.handle} verb="unfriend" label={t("members.graph.unfriend")} variant="quiet" /> : null}
              <a className="inline-flex items-center rounded-md border border-rule-strong px-3 py-2 text-sm underline" href={`/messages?to=${profile.handle}`}>{t("members.messages.message")}</a>
              {(["voice", "video"] as const).map((media) => (
                <form key={media} action={startCallAction}>
                  <input type="hidden" name="handle" value={profile.handle} />
                  <input type="hidden" name="media" value={media} />
                  <Button type="submit" variant="quiet">{t(media === "video" ? "members.calls.videoCall" : "members.calls.voiceCall")}</Button>
                </form>
              ))}
              <Verb handle={profile.handle} verb={r.muted ? "unmute" : "mute"} label={t(r.muted ? "members.graph.unmute" : "members.graph.mute")} variant="quiet" />
              <Verb handle={profile.handle} verb={r.restricted ? "unrestrict" : "restrict"} label={t(r.restricted ? "members.graph.unrestrict" : "members.graph.restrict")} variant="quiet" />
              <Verb handle={profile.handle} verb="block" label={t("members.graph.block")} variant="danger" />
              <a className="inline-flex items-center px-3 py-2 text-sm text-ink-muted underline" href={`/report?type=member&id=${profile.userId}`}>{t("members.report.member")}</a>
            </>
          )}
        </div>
      ) : null}
      {!r.blocked && shop.length ? (
        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">{t("members.market.shop")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {shop.map((l) => (
              <li key={l.id} className="grid gap-1 rounded-lg border border-rule bg-surface p-3">
                <a className="font-semibold underline" href={`/products/${l.slug}`}>{l.name}</a>
                {l.priceMinor !== null && l.currency ? <span className="text-sm">{formatMoney(l.priceMinor, l.currency, locale)}</span> : null}
                {canAct ? <a className="text-sm text-ink-muted underline" href={`/report?type=listing&id=${l.id}`}>{t("members.report.action")}</a> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {reviews && reviews.reviews.length ? (
        <section className="grid gap-3" aria-labelledby="reviews">
          <h2 id="reviews" className="text-xl font-semibold">{t("members.reviews.title")}</h2>
          <p className="flex flex-wrap gap-2 text-sm">
            {reviews.asSeller.count ? <Pill>{t("members.reviews.asSeller", { average: reviews.asSeller.average ?? 0, count: reviews.asSeller.count })}</Pill> : null}
            {reviews.asBuyer.count ? <Pill>{t("members.reviews.asBuyer", { average: reviews.asBuyer.average ?? 0, count: reviews.asBuyer.count })}</Pill> : null}
          </p>
          <ul className="grid gap-3">
            {reviews.reviews.map((review) => (
              <li key={review.id} className="grid gap-1 rounded-lg border border-rule bg-surface p-3">
                <p className="text-sm font-semibold">
                  {t("members.reviews.stars", { count: review.rating })} · {t(review.direction === "of_seller" ? "members.reviews.fromBuyer" : "members.reviews.fromSeller")}
                  {review.author ? <> · <a className="underline" href={`/@${review.author.handle}`}>{review.author.displayName}</a></> : null}
                </p>
                {review.body ? <p className="whitespace-pre-line break-words">{review.body}</p> : null}
                {actor.kind === "user" && !r.self && review.author?.handle !== viewer?.handle ? <p><a className="text-sm text-ink-muted underline" href={`/report?type=review&id=${review.id}`}>{t("members.report.action")}</a></p> : null}
                {review.reply ? <p className="border-s-2 border-rule ps-3 text-sm text-ink-muted">{t("members.reviews.replyBy", { name: profile.displayName })} {review.reply}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {reviews && reviews.reviews.length ? (
        <section className="grid gap-3" aria-labelledby="reviews">
          <h2 id="reviews" className="text-xl font-semibold">{t("members.reviews.title")}</h2>
          <p className="flex flex-wrap gap-2 text-sm">
            {reviews.asSeller.count ? <Pill>{t("members.reviews.asSeller", { average: reviews.asSeller.average ?? 0, count: reviews.asSeller.count })}</Pill> : null}
            {reviews.asBuyer.count ? <Pill>{t("members.reviews.asBuyer", { average: reviews.asBuyer.average ?? 0, count: reviews.asBuyer.count })}</Pill> : null}
          </p>
          <ul className="grid gap-3">
            {reviews.reviews.map((review) => (
              <li key={review.id} className="grid gap-1 rounded-lg border border-rule bg-surface p-3">
                <p className="text-sm font-semibold">
                  {t("members.reviews.stars", { count: review.rating })} · {t(review.direction === "of_seller" ? "members.reviews.fromBuyer" : "members.reviews.fromSeller")}
                  {review.author ? <> · <a className="underline" href={`/@${review.author.handle}`}>{review.author.displayName}</a></> : null}
                </p>
                {review.body ? <p className="whitespace-pre-line break-words">{review.body}</p> : null}
                {review.reply ? <p className="border-s-2 border-rule ps-3 text-sm text-ink-muted">{t("members.reviews.replyBy", { name: profile.displayName })} {review.reply}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!r.blocked ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-semibold">{t("members.feed.posts")}</h2>
          {posts.posts.length === 0 ? <p className="text-ink-muted">{t("members.feed.noneVisible")}</p> : null}
          {posts.posts.map((post) => (
            <PostCard key={post.id} post={post} viewerId={actor.kind === "user" ? actor.userId : null} back="/feed" timezone={business?.timezone ?? "UTC"} locale={locale} labels={postLabels(t, post)} />
          ))}
        </section>
      ) : null}
      {!viewer && actor.kind === "user" ? <a className="underline" href="/join">{t("members.graph.joinToConnect")}</a> : null}
      {actor.kind !== "user" ? <a className="underline" href="/join">{t("members.graph.joinToConnect")}</a> : null}
    </div>
  );
}
