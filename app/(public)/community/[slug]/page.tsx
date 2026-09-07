// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Input } from "@/ui/primitives";
import { getCommunitySpaceBySlug } from "../../../../plugins/community/service";
import { ServiceError } from "@/core/service";
import { getT } from "../../../i18n";
import { joinCommunityPublicAction } from "../../community-actions";

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
  searchParams: Promise<{ saved?: string; error?: string }>;
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
        <p className="text-sm text-ink-muted">{t("community.public.gated")}</p>
      )}
    </div>
  );
}
