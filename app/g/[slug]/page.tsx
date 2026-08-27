// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Client gallery lock screen and proof grid (C8.03). Noindex: the URL is a
// credential surface, not a public page.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@/ui/primitives";
import { SkipLink } from "@/ui/SkipLink";
import {
  galleryBySlug,
  viewGallerySession,
} from "@/modules/galleries/service";
import { getT } from "../../i18n";
import { GALLERY_SESSION_COOKIE } from "@/modules/galleries/cookies";
import {
  openGalleryWithLoginAction,
  redeemGalleryGuestAction,
  unlockGalleryAction,
} from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("galleries.public.title"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function ClientGalleryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; token?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const jar = await cookies();
  const [t, lock] = await Promise.all([
    getT(),
    galleryBySlug.call({ slug }, { kind: "anonymous" }),
  ]);
  if (!lock) notFound();

  const sessionToken = jar.get(GALLERY_SESSION_COOKIE)?.value;
  const session = sessionToken
    ? await viewGallerySession
        .call({ sessionToken }, { kind: "anonymous" })
        .catch(() => null)
    : null;
  // The cookie holds one session. It opens this gallery or none: a session
  // for another gallery must not render here under this address.
  const opened = session?.gallery.slug === slug ? session : null;

  if (opened) {
    return (
      <div className="mx-auto grid max-w-5xl gap-6 p-6">
        <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
        <main id="main-content" tabIndex={-1} className="grid gap-6">
          <h1 className="text-2xl font-bold tracking-tight">{opened.gallery.title}</h1>
          {opened.items.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("galleries.items.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {opened.items.map((item) => (
                <li key={item.id} className="grid gap-2">
                  <img
                    src={`/g/${slug}/view/${item.id}`}
                    alt={item.altText || item.filename || ""}
                    className="w-full rounded-md border border-rule bg-surface"
                  />
                  {item.canDownload ? (
                    <a href={`/g/${slug}/download/${item.id}`} className="text-sm underline">
                      {t("galleries.action.download")}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-md gap-6 p-6">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <main id="main-content" tabIndex={-1} className="grid gap-6">
        <h1 className="text-2xl font-bold tracking-tight">{lock.title}</h1>
        {lock.expired ? (
          <p className="text-sm text-ink-muted">{t("galleries.expired")}</p>
        ) : (
          <>
            <p className="text-sm text-ink-muted">{t("galleries.lock.intro")}</p>
            {query.error ? (
              <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
                {query.error}
              </p>
            ) : null}
            {lock.access === "pin" || lock.access === "password" ? (
              <Card>
                <CardHeader title={t(`galleries.access.${lock.access}`)} />
                <CardBody>
                  <form action={unlockGalleryAction} className="grid gap-3">
                    <input type="hidden" name="slug" value={slug} />
                    <label className="grid gap-1 text-sm">
                      <span className="text-ink-muted">{t("galleries.field.secret")}</span>
                      <input
                        name="secret"
                        type={lock.access === "password" ? "password" : "text"}
                        inputMode={lock.access === "pin" ? "numeric" : "text"}
                        required
                        className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                      />
                    </label>
                    <Button type="submit">{t("galleries.action.open")}</Button>
                  </form>
                </CardBody>
              </Card>
            ) : null}
            <form action={openGalleryWithLoginAction}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" variant="quiet">
                {t("galleries.lock.login")}
              </Button>
            </form>
            {query.token ? (
              <form action={redeemGalleryGuestAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="token" value={query.token} />
                <Button type="submit">{t("galleries.action.open")}</Button>
              </form>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
