// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Editing one page (MASTER.md §32).
//
// The server resolves the palette, the derived fields and their labels; the
// client component holds the tree and saves it. Nothing here knows what a
// heading is — see editorLabels.ts.
import { notFound } from "next/navigation";
import { ArrowSquareOut, ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { ServiceError } from "@/core/service";
import { getPage, listRevisions } from "@/modules/cms/service";
import {
  compareRevisions,
  listPreviewLinks,
  touchEditLease,
} from "@/modules/cms/lifecycle";
import { listAssets } from "@/core/media/service";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { editorBlockTypes, editorLabels } from "../../editorLabels";
import { PageEditor } from "./PageEditor";
import { RevisionList } from "./RevisionList";
import { PublishToggle } from "./PublishToggle";
import { PageLifecycle } from "./PageLifecycle";
import { currentBusiness } from "@/core/settings/read";

export const dynamic = "force-dynamic";


export default async function EditPagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ compare?: string }>;
}) {
  const actor = await requireStaffActor("cms", "manage");
  const { id } = await params;
  const query = await searchParams;

  const page = await getPage.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError) notFound();
    throw error;
  });

  const [business, revisions, library, t, links, lease, diff] = await Promise.all([
    currentBusiness(),
    listRevisions.call({ subjectType: "page", subjectId: page.id }, actor),
    listAssets.call({ kind: "image" }, actor),
    getT(),
    listPreviewLinks.call({ pageId: page.id }, actor),
    touchEditLease.call({ id: page.id }, actor),
    query.compare
      ? compareRevisions.call(
          { pageId: page.id, fromRevisionId: query.compare },
          actor,
        )
      : Promise.resolve(null),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const published = page.status === "published";

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/pages" className="text-sm text-ink-muted">
          {t("cms.pages.back")}
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">
            {page.workingTitle ?? page.title}
          </h1>
          <span className="font-mono text-xs text-ink-muted">/{page.slug}</span>
          {published ? (
            <a
              href={page.slug === "" ? "/" : `/${page.slug}`}
              className="inline-flex items-center gap-1.5 text-xs text-ink-muted underline decoration-rule underline-offset-2"
            >
              {t("cms.pages.view")}
              <ArrowSquareOut size={12} weight="bold" />
            </a>
          ) : null}
          <div className="ms-auto">
            <PublishToggle
              id={page.id}
              published={published}
              label={published ? t("cms.pages.unpublish") : t("cms.pages.publish")}
            />
          </div>
        </div>
      </div>

      <PageEditor
        id={page.id}
        initialVersion={page.version}
        initialBlocks={(page.workingBlocks ?? page.blocks) as BlockNode[]}
        blockTypes={editorBlockTypes(
          t,
          "page",
          library.rows.map((a) => ({ id: a.id, filename: a.filename })),
        )}
        labels={editorLabels(t)}
      />

      <PageLifecycle
        page={{
          id: page.id,
          approvalState: page.approvalState,
          approvalNote: page.approvalNote,
          scheduledPublishAt: page.scheduledPublishAt,
          scheduledUnpublishAt: page.scheduledUnpublishAt,
          editLeaseHeldBy: lease.held ? lease.by : undefined,
        }}
        links={links.map((link) => ({
          id: link.id,
          expiresAt: formatDateTime(link.expiresAt, timezone, locale),
          revoked: Boolean(link.revokedAt),
        }))}
        labels={{
          schedule: t("cms.pages.schedule"),
          publishAt: t("cms.pages.scheduledPublish"),
          unpublishAt: t("cms.pages.scheduledUnpublish"),
          saveSchedule: t("cms.pages.scheduleSave"),
          approval: t("cms.pages.approval"),
          requestApproval: t("cms.pages.requestApproval"),
          approve: t("cms.pages.approve"),
          reject: t("cms.pages.reject"),
          note: t("cms.pages.approvalNote"),
          previewLinks: t("cms.pages.previewLinks"),
          createLink: t("cms.pages.createPreviewLink"),
          copied: t("cms.pages.linkCopied"),
          revoke: t("cms.pages.revokeLink"),
          expires: t("cms.pages.previewExpires"),
          revoked: t("cms.pages.previewRevoked"),
          approvalNone: t("cms.pages.approvalNone"),
          approvalPending: t("cms.pages.approvalPending"),
          approvalApproved: t("cms.pages.approved"),
          approvalRejected: t("cms.pages.approvalRejected"),
          leaseHeld: t("cms.pages.editLeaseHeld"),
        }}
      />

      <Card>
        <CardHeader
          icon={<ClockCounterClockwise size={17} weight="bold" />}
          title={t("cms.revisions.title")}
        />
        <CardBody>
          {diff ? (
            <div className="mb-4 grid gap-1 text-sm text-ink">
              <p>
                {t("cms.revisions.compareResult", {
                  earlier: diff.earlier.label,
                  later: diff.later.label,
                })}
              </p>
              <p className="text-ink-muted">
                {diff.titleChanged ? t("cms.revisions.titleChanged") : t("cms.revisions.titleSame")}
                {" · "}
                +{diff.blocks.added.length} / −{diff.blocks.removed.length} / ~{diff.blocks.changed.length}
              </p>
            </div>
          ) : null}
          {revisions.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("cms.revisions.empty")}</p>
          ) : (
            <RevisionList
              pageId={page.id}
              revisions={revisions.map((revision) => ({
                id: revision.id,
                when: formatDateTime(revision.createdAt, timezone, locale),
                actor: revision.actor,
                name: revision.name,
                kind: revision.kind,
              }))}
              labels={{
                restore: t("cms.revisions.restoreDraft"),
                compare: t("cms.revisions.compare"),
                name: t("cms.revisions.name"),
                namePlaceholder: t("cms.revisions.namePlaceholder"),
                saveNamed: t("cms.revisions.saveNamed"),
                unnamed: t("cms.revisions.unnamed"),
              }}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
