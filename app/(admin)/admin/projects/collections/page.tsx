// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { listCollections } from "@/modules/projects/portfolio-service";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import { createCollectionAction } from "../../../project-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const KINDS = ["portfolio", "service", "industry", "season"] as const;

export default async function ProjectCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireStaffActor("projects");
  const [t, collections, query] = await Promise.all([
    getT(),
    domainOrNull(listCollections.call({}, actor)),
    searchParams,
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/projects" className="text-sm text-ink-muted">
          {t("projects.collections.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">
          {t("projects.collections.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("projects.collections.intro")}
        </p>
      </div>

      {query.error ? (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("projects.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("projects.collections.current")} />
        <CardBody>
          {collections === null ? (
            <p className="text-sm text-danger">{t("projects.collections.unavailable")}</p>
          ) : collections.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("projects.collections.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {collections.map((collection) => (
                <li key={collection.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <a href={`/admin/projects/collections/${collection.id}`} className="font-semibold underline">
                    {collection.name}
                  </a>
                  <Pill tone={collection.publicationStatus === "published" ? "success" : "neutral"}>
                    {t(`projects.publication.${collection.publicationStatus}`)}
                  </Pill>
                  <span className="text-ink-muted">{t(`projects.collections.kind.${collection.kind}`)}</span>
                  <span className="ms-auto tabular-nums text-ink-muted">
                    {t("projects.collections.projectCount", { count: String(collection.projectCount) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("projects.collections.create")} />
        <CardBody>
          <form action={createCollectionAction} className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.collections.field.name")}</span>
              <input name="name" required maxLength={160} className="rounded-md border border-rule bg-field px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.collections.field.kind")}</span>
              <select name="kind" defaultValue="portfolio" className="rounded-md border border-rule bg-field px-3 py-2">
                {KINDS.map((kind) => <option key={kind} value={kind}>{t(`projects.collections.kind.${kind}`)}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-ink-muted">{t("projects.collections.field.description")}</span>
              <textarea name="description" maxLength={2000} rows={3} className="rounded-md border border-rule bg-field px-3 py-2" />
            </label>
            <input type="hidden" name="position" value="0" />
            <div className="sm:col-span-2"><Button type="submit">{t("projects.collections.action.create")}</Button></div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
