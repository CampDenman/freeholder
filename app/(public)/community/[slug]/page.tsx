// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/ui/primitives";
import {
  getCommunityFeedBySlug,
  getCommunitySpaceBySlug,
} from "../../../../plugins/community/service";
import { ServiceError } from "@/core/service";
import { getT } from "../../../i18n";
import {
  createCommunityPostPublicAction,
  joinCommunityPublicAction,
  reportCommunityPostPublicAction,
  requestCommunityJoinPublicAction,
} from "../../community-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const page = await getCommunitySpaceBySlug.call({ slug }, { kind: "anonymous" });
    return { title: page.space.title };
  } catch {
    return { title: "Community" };
  }
}

export default async function PublicCommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    requested?: string;
    reported?: string;
    email?: string;
  }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const t = await getT();
  let page;
  try {
    page = await getCommunitySpaceBySlug.call({ slug }, { kind: "anonymous" });
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }

  let feed: Awaited<ReturnType<typeof getCommunityFeedBySlug.call>> | null = null;
  let feedFailed = false;
  try {
    feed = await getCommunityFeedBySlug.call(
      { slug, email: query.email || undefined },
      { kind: "anonymous" },
    );
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    feedFailed = true;
  }

  const path = `/community/${encodeURIComponent(slug)}`;
  const canRead = feed?.canRead === true;
  const rooms = feed?.rooms ?? [];
  const posts = feed?.posts ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{page.space.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("community.public.intro")} {t("community.members", { count: page.memberCount })}
        </p>
      </div>
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("community.public.thanks")}
        </p>
      ) : null}
      {query.requested ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("community.public.requestThanks")}
        </p>
      ) : null}
      {query.reported ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("community.public.reported")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {page.space.access === "open" ? (
        <Card>
          <CardHeader title={t("community.public.join")} />
          <CardBody>
            <form action={joinCommunityPublicAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="slug" value={slug} />
              <Field label={t("community.public.name")} htmlFor="community-name">
                <Input id="community-name" name="name" required autoComplete="name" />
              </Field>
              <Field label={t("community.public.email")} htmlFor="community-email">
                <Input id="community-email" name="email" type="email" required autoComplete="email" />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit">{t("community.public.join")}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : (
        <>
          <p className="text-sm text-ink-muted">{t("community.public.gated")}</p>
          <Card>
            <CardHeader title={t("community.public.request")} />
            <CardBody>
              <form action={requestCommunityJoinPublicAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="slug" value={slug} />
                <Field label={t("community.public.name")} htmlFor="community-request-name">
                  <Input id="community-request-name" name="name" required autoComplete="name" />
                </Field>
                <Field label={t("community.public.email")} htmlFor="community-request-email">
                  <Input
                    id="community-request-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit">{t("community.public.request")}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("community.public.memberView")} />
            <CardBody>
              <form method="get" className="grid gap-3 sm:grid-cols-2">
                <Field label={t("community.public.email")} htmlFor="community-member-email">
                  <Input
                    id="community-member-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    defaultValue={query.email ?? ""}
                  />
                </Field>
                <div className="flex items-end">
                  <Button type="submit">{t("community.public.memberView")}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        </>
      )}

      {feedFailed ? (
        <Card>
          <CardHeader title={t("community.posts")} />
          <CardBody>
            <p className="text-sm text-danger">{t("community.public.feedError")}</p>
            <a className="text-sm font-medium text-accent" href={path}>
              {t("community.public.retry")}
            </a>
          </CardBody>
        </Card>
      ) : canRead ? (
        <>
          <Card>
            <CardHeader title={t("community.posts")} />
            <CardBody>
              {posts.length === 0 ? (
                <p className="text-sm text-ink-muted">{t("community.public.feedEmpty")}</p>
              ) : (
                <ul className="grid list-none gap-3 p-0">
                  {posts.map((post) => (
                    <li key={post.id} className="rounded-md border border-rule p-3">
                      <p className="text-sm font-medium">{post.authorName}</p>
                      <p className="text-xs text-ink-muted">{post.roomTitle}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{post.body}</p>
                      <form action={reportCommunityPostPublicAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="postId" value={post.id} />
                        <Field label={t("community.public.name")} htmlFor={`report-name-${post.id}`}>
                          <Input
                            id={`report-name-${post.id}`}
                            name="name"
                            required
                            autoComplete="name"
                          />
                        </Field>
                        <Field label={t("community.public.email")} htmlFor={`report-email-${post.id}`}>
                          <Input
                            id={`report-email-${post.id}`}
                            name="email"
                            type="email"
                            required
                            autoComplete="email"
                            defaultValue={query.email ?? ""}
                          />
                        </Field>
                        <div className="sm:col-span-2">
                          <Button type="submit" variant="quiet">
                            {t("community.public.report")}
                          </Button>
                        </div>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {rooms.length > 0 ? (
            <Card>
              <CardHeader title={t("community.public.post")} />
              <CardBody>
                <form action={createCommunityPostPublicAction} className="grid gap-3">
                  <input type="hidden" name="slug" value={slug} />
                  <Field label={t("community.field.room")} htmlFor="community-post-room">
                    <Select id="community-post-room" name="roomSlug" required>
                      {rooms.map((room) => (
                        <option key={room.id} value={room.slug}>
                          {room.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("community.public.name")} htmlFor="community-post-name">
                    <Input id="community-post-name" name="name" required autoComplete="name" />
                  </Field>
                  <Field label={t("community.public.email")} htmlFor="community-post-email">
                    <Input
                      id="community-post-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      defaultValue={query.email ?? ""}
                    />
                  </Field>
                  <Field label={t("community.field.body")} htmlFor="community-post-body">
                    <textarea
                      id="community-post-body"
                      name="body"
                      required
                      maxLength={2000}
                      rows={4}
                      className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
                    />
                  </Field>
                  <div>
                    <Button type="submit">{t("community.public.post")}</Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : page.space.access === "gated" ? (
        <p className="text-sm text-ink-muted">{t("community.public.gatedFeed")}</p>
      ) : null}
    </div>
  );
}
