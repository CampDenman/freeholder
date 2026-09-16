// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { listAssets } from "@/core/media/service";
import { listProjects } from "@/modules/projects/service";
import { getCollection } from "@/modules/projects/portfolio-service";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { domainOrNull } from "../../../../read-helpers";
import {
  collectionMembershipAction,
  collectionPublicationAction,
  updateCollectionAction,
} from "../../../../project-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const KINDS = ["portfolio", "service", "industry", "season"] as const;

export default async function ProjectCollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("projects");
  const { id } = await params;
  const [t, collection, allProjects, library, query] = await Promise.all([
    getT(),
    domainOrNull(getCollection.call({ id }, actor)),
    domainOrNull(listProjects.call({ limit: 200 }, actor)),
    domainOrNull(listAssets.call({ kind: "image", limit: 100 }, actor)),
    searchParams,
  ]);
  if (!collection) notFound();
  const memberIds = new Set(collection.projects.map((item) => item.projectId));
  const availableProjects = (allProjects ?? []).filter((project) => !memberIds.has(project.id));
  const images = library?.rows ?? [];

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/projects/collections" className="text-sm text-ink-muted">
          {t("projects.collections.backToCollections")}
        </a>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight">
          {collection.name}
          <Pill tone={collection.publicationStatus === "published" ? "success" : "neutral"}>
            {t(`projects.publication.${collection.publicationStatus}`)}
          </Pill>
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("projects.collections.address", { slug: collection.slug })}
        </p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">{t("projects.saved")}</p>
      ) : null}
      {query.error ? (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("projects.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("projects.collections.publication")} />
        <CardBody>
          <p className="max-w-prose text-sm text-ink-muted">{t("projects.collections.publicationHint")}</p>
          <form action={collectionPublicationAction} className="flex flex-wrap gap-3">
            <input type="hidden" name="id" value={collection.id} />
            {collection.publicationStatus === "published" ? (
              <>
                <a href={`/portfolio/collections-${collection.slug}`} className="rounded-md border border-rule px-4 py-2 text-sm font-semibold text-ink">
                  {t("projects.collections.action.view")}
                </a>
                <Button type="submit" name="intent" value="unpublish" variant="quiet">{t("projects.collections.action.unpublish")}</Button>
              </>
            ) : (
              <Button type="submit" name="intent" value="publish">{t("projects.collections.action.publish")}</Button>
            )}
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("projects.collections.details")} />
        <CardBody>
          <form action={updateCollectionAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={collection.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.collections.field.name")}</span>
              <input name="name" required maxLength={160} defaultValue={collection.name} className="rounded-md border border-rule bg-field px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.collections.field.kind")}</span>
              <select name="kind" defaultValue={collection.kind} className="rounded-md border border-rule bg-field px-3 py-2">
                {KINDS.map((kind) => <option key={kind} value={kind}>{t(`projects.collections.kind.${kind}`)}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-ink-muted">{t("projects.collections.field.description")}</span>
              <textarea name="description" maxLength={2000} rows={4} defaultValue={collection.description ?? ""} className="rounded-md border border-rule bg-field px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.collections.field.cover")}</span>
              <select name="coverAssetId" defaultValue={collection.coverAssetId ?? ""} className="rounded-md border border-rule bg-field px-3 py-2">
                <option value="">{t("projects.collections.noCover")}</option>
                {images.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}{asset.altText ? "" : ` — ${t("projects.collections.missingAlt")}`}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{t("projects.collections.field.position")}</span>
              <input type="number" name="position" min="0" max="100000" defaultValue={collection.position} className="rounded-md border border-rule bg-field px-3 py-2" />
            </label>
            <div className="sm:col-span-2"><Button type="submit">{t("projects.collections.action.save")}</Button></div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("projects.collections.projects")} />
        <CardBody>
          {collection.projects.length ? (
            <ul className="grid list-none gap-2 p-0">
              {collection.projects.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <a href={`/admin/projects/${item.projectId}`} className="font-semibold underline">{item.title}</a>
                  <Pill tone={item.publicationStatus === "published" ? "success" : "neutral"}>{t(`projects.publication.${item.publicationStatus}`)}</Pill>
                  <span className="ms-auto tabular-nums">{item.position}</span>
                  <form action={collectionMembershipAction}>
                    <input type="hidden" name="collectionId" value={collection.id} />
                    <input type="hidden" name="id" value={item.id} />
                    <Button type="submit" name="intent" value="remove" variant="quiet">{t("projects.collections.action.remove")}</Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">{t("projects.collections.noProjects")}</p>
          )}
          {availableProjects.length ? (
            <form action={collectionMembershipAction} className="flex flex-wrap items-end gap-3 border-t border-rule pt-5">
              <input type="hidden" name="collectionId" value={collection.id} />
              <label className="grid min-w-64 flex-1 gap-1 text-sm">
                <span className="text-ink-muted">{t("projects.collections.field.project")}</span>
                <select name="projectId" required className="rounded-md border border-rule bg-field px-3 py-2">
                  {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{t("projects.collections.field.position")}</span>
                <input type="number" name="position" min="0" max="100000" defaultValue="0" className="w-28 rounded-md border border-rule bg-field px-3 py-2" />
              </label>
              <Button type="submit">{t("projects.collections.action.add")}</Button>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
