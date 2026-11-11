// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { listImports } from "@/core/import/service";
import { ImportStepForms } from "../ImportForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ImportRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireStaffActor("platform");
  const [t, runs] = await Promise.all([getT(), listImports.call({}, actor)]);
  const run = runs.find((item) => item.id === id);
  if (!run) notFound();
  const counts = run.counts && typeof run.counts === "object" ? (run.counts as Record<string, unknown>) : {};
  const countLabels: Array<[string, string]> = [
    ["pages", t("imports.count.pages")],
    ["crawlBlocked", t("imports.count.crawlBlocked")],
    ["crawlRequests", t("imports.count.crawlRequests")],
    ["crawlBytes", t("imports.count.crawlBytes")],
    ["posts", t("imports.count.posts")],
    ["media", t("imports.count.media")],
    ["mediaFailed", t("imports.count.mediaFailed")],
    ["redirects", t("imports.count.redirects")],
    ["menus", t("imports.count.menus")],
    ["menuWarnings", t("imports.count.menuWarnings")],
    ["categories", t("imports.count.categories")],
    ["tags", t("imports.count.tags")],
    ["authors", t("imports.count.authors")],
    ["commentsImported", t("imports.count.commentsImported")],
    ["commentsStaged", t("imports.count.commentsStaged")],
    ["commentsSkipped", t("imports.count.commentsSkipped")],
    ["skippedPages", t("imports.count.skippedPages")],
  ];
  const shown = countLabels.filter(([key]) => typeof counts[key] === "number");
  const wordpress = run.source.startsWith("wordpress-");
  const checkpoint = run.checkpoint && typeof run.checkpoint === "object" ? run.checkpoint as Record<string, unknown> : {};
  const report = checkpoint.report && typeof checkpoint.report === "object" ? checkpoint.report as Record<string, unknown> : {};
  const parsedIssues = z.array(z.object({ menu: z.string(), label: z.string(), reason: z.enum(["target", "private"]) })).safeParse(report.menuIssues);
  const menuIssues = parsedIssues.success ? parsedIssues.data.slice(0, 100) : [];

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/imports" className="text-sm text-ink-muted">
          {t("imports.back")}
        </Link>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{run.source}</h1>
        <Pill tone="neutral">{t(`imports.status.${run.status}`)}</Pill>
      </div>
      <Card>
        <CardHeader title={t("imports.progress")} />
        <CardBody>
          <ImportStepForms
            id={run.id}
            status={run.status}
            sourceKind={run.kind ?? "html"}
            origin={run.origin ?? ""}
            labels={{
              preview: t("imports.preview"),
              url: t("imports.pageUrl"),
              slug: t("imports.slug"),
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
          />
        </CardBody>
      </Card>
      {shown.length > 0 || run.error ? (
        <Card>
          <CardHeader title={t("imports.report")} />
          <CardBody>
            {run.error ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {run.error}
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
            {wordpress ? (
              <p className="mt-4 max-w-prose text-sm text-ink-muted">{t("imports.note.wordpress")}</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
