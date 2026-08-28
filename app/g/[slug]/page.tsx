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
  galleryArchiveState,
  galleryBySlug,
  viewGallerySession,
} from "@/modules/galleries/service";
import { getT } from "../../i18n";
import { GALLERY_SESSION_COOKIE } from "@/modules/galleries/cookies";
import {
  clearGallerySelectionAction,
  openGalleryWithLoginAction,
  redeemGalleryGuestAction,
  requestGalleryArchiveAction,
  setGallerySelectionAction,
  submitGalleryRoundAction,
  unlockGalleryAction,
} from "../actions";

export const dynamic = "force-dynamic";

/** §4.5's three verdicts, in the order a client works through them. */
const PROOF_KINDS = ["favorite", "select", "reject"] as const;

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

  // Keyed by asset because a selection is about the photograph, not the row
  // that happens to carry it into this gallery.
  const marks = new Map((opened?.selections ?? []).map((s) => [s.assetId, s]));
  // Reopening opens a fresh round, so the note explaining why lives on the
  // round that was decided rather than the one now in play.
  const sentBack =
    opened?.round?.state === "open" && opened.lastDecided?.state === "reopened"
      ? opened.lastDecided
      : null;
  // Only worth asking about once the gallery can actually hand files over.
  const archive =
    opened && opened.gallery.downloadPolicy !== "none" && sessionToken
      ? await galleryArchiveState
          .call({ sessionToken }, { kind: "anonymous" })
          .catch(() => null)
      : null;

  if (opened) {
    return (
      <div className="mx-auto grid max-w-5xl gap-6 p-6">
        <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
        <main id="main-content" tabIndex={-1} className="grid gap-6">
          <h1 className="text-2xl font-bold tracking-tight">{opened.gallery.title}</h1>
          {/* Where the conversation stands. A client who has sent their
              choices needs to know they landed; one whose round came back
              needs to know what to look at again. */}
          {opened.round?.state === "submitted" ? (
            <p className="rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink-muted">
              {t("galleries.round.submitted")}
            </p>
          ) : null}
          {opened.round?.state === "approved" ? (
            <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
              {t("galleries.round.approved")}
            </p>
          ) : null}
          {sentBack ? (
            <div className="grid gap-1 rounded-md border border-rule bg-surface px-3 py-2 text-sm">
              <p className="text-ink-muted">{t("galleries.round.reopened")}</p>
              {sentBack.note ? <p>“{sentBack.note}”</p> : null}
            </div>
          ) : null}
          {opened.items.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("galleries.items.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {opened.items.map((item) => {
                const mark = marks.get(item.assetId);
                return (
                  <li key={item.id} className="grid gap-2">
                    <img
                      src={`/g/${slug}/view/${item.id}`}
                      alt={item.altText || item.filename || ""}
                      className="w-full rounded-md border border-rule bg-surface"
                    />
                    {/* Buttons rather than a script: a client proofing on a
                        phone with a bad connection still gets to choose. */}
                    <div className="flex flex-wrap items-center gap-2">
                      {PROOF_KINDS.map((kind) => (
                        <form key={kind} action={setGallerySelectionAction}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="kind" value={kind} />
                          <Button
                            type="submit"
                            variant={mark?.kind === kind ? "primary" : "quiet"}
                            aria-pressed={mark?.kind === kind}
                          >
                            {t(`galleries.proof.${kind}`)}
                          </Button>
                        </form>
                      ))}
                      {mark ? (
                        <form action={clearGallerySelectionAction}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <Button type="submit" variant="quiet">
                            {t("galleries.proof.clear")}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                    <form action={setGallerySelectionAction} className="grid gap-1">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="kind" value={mark?.kind ?? "favorite"} />
                      <label className="grid gap-1 text-sm">
                        <span className="text-ink-muted">{t("galleries.proof.comment")}</span>
                        <input
                          name="comment"
                          defaultValue={mark?.comment ?? ""}
                          className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                        />
                      </label>
                      <Button type="submit" variant="quiet">
                        {t("galleries.proof.saveComment")}
                      </Button>
                    </form>
                    {item.canDownload ? (
                      <a href={`/g/${slug}/download/${item.id}`} className="text-sm underline">
                        {t("galleries.action.download")}
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {opened.items.length > 0 && (opened.round?.state ?? "open") === "open" ? (
            <form action={submitGalleryRoundAction}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit">{t("galleries.round.submit")}</Button>
            </form>
          ) : null}
          {opened.gallery.downloadPolicy !== "none" && opened.items.length > 0 ? (
            <div className="grid gap-2">
              <h2 className="text-lg font-semibold">{t("galleries.archive")}</h2>
              {archive?.state === "building" ? (
                <p className="text-sm text-ink-muted">{t("galleries.archive.building")}</p>
              ) : null}
              {archive?.state === "failed" ? (
                <p className="text-sm text-danger">{t("galleries.archive.failed")}</p>
              ) : null}
              {archive?.state === "ready" ? (
                <a href={`/g/${slug}/archive`} className="text-sm underline">
                  {t("galleries.archive.get")}
                </a>
              ) : (
                <form action={requestGalleryArchiveAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <Button type="submit" variant="quiet">
                    {t("galleries.archive.request")}
                  </Button>
                </form>
              )}
            </div>
          ) : null}
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
