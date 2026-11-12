// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { listImports } from "@/core/import/service";
import { ImportStepForms } from "../ImportForms";
import { GraphImportControls } from "../GraphImportControls";
import { sourceGraphReview } from "@/core/import/graph-query";
import { readerOwnershipReview } from "@/core/import/reader-ownership-review";
import { listContacts } from "@/core/contacts/service";
import { ReaderOwnershipForm } from "../ReaderOwnershipForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ImportRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ after?: string; mediaAfter?: string; readersAfter?: string; readerContact?: string }>;
}) {
  const { id } = await params;
  const actor = await requireStaffActor("platform");
  const [t, runs] = await Promise.all([getT(), listImports.call({}, actor)]);
  const run = runs.find((item) => item.id === id);
  if (!run) notFound();
  const counts = run.counts && typeof run.counts === "object" ? (run.counts as Record<string, unknown>) : {};
  const checkpoint = run.checkpoint && typeof run.checkpoint === "object" ? run.checkpoint as Record<string, unknown> : {};
  const search = await searchParams;
  const readers = actor.kind === "user" && actor.role === "owner" && ["wordpress-wxr", "wordpress-rest"].includes(run.kind ?? "") ? await readerOwnershipReview.call({ id, after: typeof search.readersAfter === "string" && search.readersAfter.length <= 260 ? search.readersAfter : "" }, actor) : null;
  const readerContacts = readers?.rows.length ? await listContacts.call({ search: typeof search.readerContact === "string" ? search.readerContact.slice(0, 200) : undefined, limit: 50 }, actor) : null;
  const after = z.coerce.number().int().min(-1).max(9_999).safeParse(search.after ?? -1);
  const graph = checkpoint.sourceGraph ? await sourceGraphReview.call({ id, afterOrdinal: after.success ? after.data : -1, afterMediaKey: typeof search.mediaAfter === "string" && search.mediaAfter.length <= 4_096 ? search.mediaAfter : "" }, actor) : null;
  const rollback = checkpoint.rolledBack && typeof checkpoint.rolledBack === "object" ? checkpoint.rolledBack as Record<string, unknown> : {};
  const reportStatus = run.status === "rolled_back" && typeof rollback.fromStatus === "string" ? rollback.fromStatus : run.status;
  const staged = ["discover", "mapped", "previewed", "failed"].includes(reportStatus) && !(graph && typeof counts.sourcePages === "number");
  const countLabels: Array<[string, string]> = [
    ["indexed", t("imports.resume.entries")],
    ["pages", t(staged ? "imports.count.pagesStaged" : "imports.count.pages")],
    ["crawlBlocked", t("imports.count.crawlBlocked")],
    ["crawlRequests", t("imports.count.crawlRequests")],
    ["crawlBytes", t("imports.count.crawlBytes")],
    ["posts", t("imports.count.posts")],
    ["media", t(staged ? "imports.count.mediaFound" : "imports.count.media")],
    ["mediaFailed", t("imports.count.mediaFailed")],
    ["redirects", t(staged ? "imports.count.redirectsProposed" : "imports.count.redirects")],
    ["menus", t("imports.count.menus")],
    ["menuWarnings", t("imports.count.menuWarnings")],
    ["categories", t("imports.count.categories")],
    ["tags", t("imports.count.tags")],
    ["authors", t("imports.count.authors")],
    ["commentsImported", t("imports.count.commentsImported")],
    ["commentsStaged", t("imports.count.commentsStaged")],
    ["commentsSkipped", t("imports.count.commentsSkipped")],
    ["skippedPages", t("imports.count.skippedPages")],
    ["filesNotImported", t("imports.count.filesNotImported")],
    ["mediaWarnings", t("imports.count.mediaWarnings")],
    ["elementsNotImported", t("imports.count.elementsNotImported")],
    ["sourceWarnings", t("imports.count.sourceWarnings")],
  ];
  const shown = countLabels.filter(([key]) => typeof counts[key] === "number");
  const wordpress = run.source.startsWith("wordpress-");
  const preview = run.preview && typeof run.preview === "object" ? run.preview as Record<string, unknown> : {};
  const archive = preview.archive && typeof preview.archive === "object" ? preview.archive as Record<string, unknown> : {};
  const generic = preview.generic && typeof preview.generic === "object" ? preview.generic as Record<string, unknown> : {};
  const reportValue = checkpoint.report ?? archive.report ?? generic.report;
  const report = reportValue && typeof reportValue === "object" ? reportValue as Record<string, unknown> : {};
  const filesNotImported = z.array(z.string()).safeParse(report.ignored);
  const mediaWarnings = z.array(z.string()).safeParse(report.unresolvedImages ?? report.unresolvedMedia);
  const sourceWarnings = z.array(z.object({ code: z.enum(["query-address", "discovery-only"]), url: z.string() })).safeParse(report.sourceWarnings);
  const parsedIssues = z.array(z.object({ menu: z.string(), label: z.string(), reason: z.enum(["target", "private"]) })).safeParse(report.menuIssues);
  const menuIssues = parsedIssues.success ? parsedIssues.data.slice(0, 100) : [];

  return (
    <div className="grid min-w-0 gap-6">
      <div>
        <Link href="/admin/imports" className="text-sm text-ink-muted">
          {t("imports.back")}
        </Link>
        <h1 className="mt-2 break-all text-xl font-bold tracking-tight">{run.source}</h1>
        <Pill tone="neutral">{t(`imports.status.${run.status}`)}</Pill>
      </div>
      {run.status === "rolled_back" && Array.isArray(rollback.keptPages) && rollback.keptPages.length > 0 ? <p role="status" className="break-words text-sm text-ink-muted">{t("imports.rollbackRetainedPages")}</p> : null}
      {readers && (readers.rows.length > 0 || readers.next) ? <Card>
        <CardHeader title={t("imports.readers.title")} />
        <CardBody>
          <div className="grid min-w-0 gap-5">
            <p className="text-sm text-ink-muted">{t("imports.readers.intro")}</p>
            <form method="get" className="flex min-w-0 flex-wrap items-end gap-3">
              <input type="hidden" name="readersAfter" value={search.readersAfter ?? ""} />
              <div className="min-w-0 flex-1"><Field htmlFor="reader-contact-search" label={t("imports.readers.find")}>
                <Input id="reader-contact-search" name="readerContact" maxLength={200} defaultValue={search.readerContact ?? ""} />
              </Field></div>
              <Button type="submit">{t("imports.readers.find")}</Button>
              <Link href="/admin/contacts/new" className="text-sm text-accent underline">{t("imports.readers.create")}</Link>
            </form>
            <ol className="grid min-w-0 list-none gap-5 p-0">{readers.rows.map(reader => <li key={reader.receiptId ?? `${reader.postId}:${reader.commentId}`} className="grid min-w-0 gap-3 rounded-md border border-rule p-3">
              <p className="break-words font-medium">{reader.name}</p>
              {reader.email ? <p className="min-w-0 break-all text-sm"><bdi dir="ltr">{reader.email}</bdi></p> : null}
              <p className="break-words text-sm text-ink-muted">{reader.excerpt}</p>
              <ReaderOwnershipForm id={id} reader={reader} contacts={(readerContacts?.rows ?? []).filter(contact => contact.source !== "privacy-erasure").map(contact => ({ id: contact.id, name: contact.name, email: contact.email }))} labels={{ person: t("imports.readers.person"), choose: t("imports.readers.choose"), confirm: t("imports.readers.confirm"), submit: t("imports.readers.submit") }} />
            </li>)}</ol>
            {readers.next ? <Link href={`/admin/imports/${id}?readersAfter=${encodeURIComponent(readers.next)}`} className="text-sm text-accent underline">{t("imports.readers.next")}</Link> : null}
          </div>
        </CardBody>
      </Card> : null}
      <Card>
        <CardHeader title={t("imports.progress")} />
        <CardBody>
          {graph ? <GraphImportControls id={id} status={run.status} version={graph.version} upload={graph.upload} indexComplete={graph.indexComplete} planFrozen={graph.planFrozen} planReady={graph.planReady} invalidated={graph.invalidated} labels={{
            intro: t("imports.resume.intro"), index: t("imports.resume.index"), commit: t("imports.resume.commit"), pause: t("imports.resume.pause"), working: t("imports.resume.working"), failed: t("imports.resume.failed"), saved: t("imports.resume.saved"), restoreHint: t("imports.resume.restoreHint"), limits: t("imports.resume.limits"), reviewHint: t("imports.resume.reviewHint"),
            review: t("imports.review"), slug: t("imports.slug"), slugHint: t("cms.field.slugHint"), keep: t("imports.keepExisting"), replace: t("imports.replace"), rename: t("imports.rename"), renamedSlug: t("imports.renamedSlug"), reconcile: t("imports.reconcile"), publish: t("imports.publish"), rollback: t("imports.rollback"), upload: t("imports.upload"), uploadHint: t("imports.uploadHint"), stage: t("imports.stage"), uploading: t("imports.uploading"), readingSource: t("imports.readingSource"), uploadFailed: t("imports.uploadFailed"),
          }} /> : <ImportStepForms
            id={run.id}
            status={run.status}
            sourceKind={run.kind ?? "html"}
            origin={run.origin ?? ""}
            labels={{
              preview: t("imports.preview"),
              url: t("imports.pageUrl"),
              slug: t("imports.slug"),
              slugHint: t("cms.field.slugHint"),
              title: t("imports.pageTitle"),
              pageKind: t("imports.pageKind"),
              page: t("imports.kindPage"),
              post: t("imports.kindPost"),
              map: t("imports.map"),
              review: t("imports.review"),
              keep: t("imports.keepExisting"),
              replace: t("imports.replace"),
              rename: t("imports.rename"),
              renamedSlug: t("imports.renamedSlug"),
              commit: t("imports.commit"),
              reconcile: t("imports.reconcile"),
              publish: t("imports.publish"),
              rollback: t("imports.rollback"),
              upload: t("imports.upload"),
              uploadHint: t("imports.uploadHint"),
              stage: t("imports.stage"),
              uploading: t("imports.uploading"),
              readingSource: t("imports.readingSource"),
              uploadFailed: t("imports.uploadFailed"),
              sourceUrl: t("imports.sourceUrl"),
              crawl: t("imports.crawl"),
              crawlHint: t("imports.crawlHint"),
              crawling: t("imports.crawling"),
            }}
          />}
        </CardBody>
      </Card>
      {graph ? <Card><CardHeader title={t("imports.resume.title")} /><CardBody>
        <div className="grid min-w-0 gap-5">
          <ol className="grid min-w-0 list-none gap-3 p-0">
            {graph.entries.map(entry => <li key={entry.ordinal} className="grid min-w-0 gap-1 rounded-md border border-rule p-3 text-sm">
              <p className="break-words font-medium">{entry.title || entry.sourceUrl || entry.kind}</p>
              {entry.sourceUrl ? <p className="min-w-0 break-all"><span className="text-ink-muted">{t("imports.resume.source")}: </span><bdi dir="ltr">{entry.sourceUrl}</bdi></p> : null}
              {entry.destinationPath !== null ? <p className="min-w-0 break-all"><span className="text-ink-muted">{t("imports.resume.destination")}: </span><bdi dir="ltr">/{entry.destinationPath}</bdi></p> : null}
              {entry.resolution ? <p className="text-ink-muted">{t(entry.resolution === "keep-existing" ? "imports.keepExisting" : entry.resolution === "replace" ? "imports.replace" : "imports.rename")}</p> : null}
            </li>)}
          </ol>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href={`/admin/imports/${id}`}>{t("imports.resume.first")}</Link>
            {graph.nextOrdinal !== null ? <Link href={`/admin/imports/${id}?after=${graph.nextOrdinal}`}>{t("imports.resume.next")}</Link> : null}
          </div>
          {graph.media.length ? <div className="grid min-w-0 gap-3">
            <h2 className="text-sm font-semibold">{t("imports.resume.media")}</h2>
            <ul className="grid min-w-0 list-none gap-3 p-0">{graph.media.map(file => <li key={file.key} className="grid min-w-0 gap-1 rounded-md border border-rule p-3 text-sm">
              <bdi dir="ltr" className="break-all">{file.sourceUrl}</bdi>
              {file.error ? <p className="break-words text-danger">{t("imports.resume.failed")}</p> : null}
            </li>)}</ul>
            {graph.nextMediaKey !== null ? <Link href={`/admin/imports/${id}?mediaAfter=${encodeURIComponent(graph.nextMediaKey)}`} className="text-sm">{t("imports.resume.nextMedia")}</Link> : null}
          </div> : null}
        </div>
      </CardBody></Card> : null}
      {shown.length > 0 || run.error ? (
        <Card>
          <CardHeader title={t("imports.report")} />
          <CardBody>
            {run.error ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {graph ? t("imports.resume.failed") : run.error}
              </p>
            ) : null}
            {shown.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                {shown.map(([key, label]) => (
                  <div key={key} className="grid gap-0.5">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="font-semibold text-ink">{String(counts[key])}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {menuIssues.length ? <div className="mt-4 grid min-w-0 gap-2">
              <h3 className="text-sm font-semibold">{t("imports.count.menuWarnings")}</h3>
              <ul className="grid list-none gap-3 p-0">
                {menuIssues.map((issue, index) => <li key={index} className="min-w-0 break-words text-sm">
                  <p className="font-medium">{issue.label || issue.menu}</p>
                  <p className="text-ink-muted">{t(`imports.menuWarning.${issue.reason}`)}</p>
                </li>)}
              </ul>
            </div> : null}
            {run.kind === "archive" || preview.sourceFormat === "generic-site" ? <div className="mt-4 grid min-w-0 gap-3">
              <p className="max-w-prose text-sm text-ink-muted">{t(run.kind === "archive" ? "imports.note.archive" : "imports.note.generic")}</p>
              {[
                { label: t("imports.count.filesNotImported"), values: filesNotImported.success ? filesNotImported.data : [] },
                { label: t("imports.count.mediaWarnings"), values: mediaWarnings.success ? mediaWarnings.data : [] },
              ].filter(group => group.values.length).map(group => <div key={group.label} className="grid min-w-0 gap-2">
                <h3 className="text-sm font-semibold">{group.label}</h3>
                <ul className="grid min-w-0 list-none gap-1 p-0">{group.values.slice(0, 100).map((value, index) => <li key={index} dir={value.startsWith("data:") ? undefined : "ltr"} className={`min-w-0 text-sm text-ink-muted ${value.startsWith("data:") ? "break-words" : "break-all"}`}>{value.startsWith("data:") ? t("imports.mediaWarning.inline") : value.slice(0, 2_048)}</li>)}</ul>
              </div>)}
              {sourceWarnings.success && sourceWarnings.data.length ? <ul className="grid min-w-0 list-none gap-3 p-0">{sourceWarnings.data.map((warning, index) => <li key={index} className="min-w-0 text-sm">
                <p className="break-words">{t(`imports.sourceWarning.${warning.code}`)}</p><p dir="ltr" className="break-all text-ink-muted">{warning.url}</p>
              </li>)}</ul> : null}
            </div> : null}
            {wordpress ? (
              <p className="mt-4 max-w-prose text-sm text-ink-muted">{t("imports.note.wordpress")}</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
