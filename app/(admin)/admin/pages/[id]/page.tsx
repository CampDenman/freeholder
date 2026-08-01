// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Editing one page (MASTER.md §32).
//
// The server resolves the palette, the derived fields and their labels; the
// client component holds the tree and saves it. Nothing here knows what a
// heading is — see editorLabels.ts.
import { notFound } from "next/navigation";
import { ArrowSquareOut, ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { getBusiness } from "@/core/settings/service";
import { ServiceError } from "@/core/service";
import { getPage, listRevisions } from "@/modules/cms/service";
import { listAssets } from "@/core/media/service";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { Card, CardBody, CardHeader } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { editorBlockTypes, editorLabels } from "../../editorLabels";
import { PageEditor } from "./PageEditor";
import { RevisionList } from "./RevisionList";
import { PublishToggle } from "./PublishToggle";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function EditPagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor();
  const { id } = await params;

  const page = await getPage.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError) notFound();
    throw error;
  });

  const [business, revisions, library, t] = await Promise.all([
    getBusiness.call({}, ANONYMOUS),
    listRevisions.call({ subjectType: "page", subjectId: page.id }, actor),
    listAssets.call({ kind: "image" }, actor),
    getT(),
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
          <h1 className="text-xl font-bold tracking-tight">{page.title}</h1>
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
        initialBlocks={page.blocks as BlockNode[]}
        blockTypes={editorBlockTypes(
          t,
          "page",
          library.rows.map((a) => ({ id: a.id, filename: a.filename })),
        )}
        labels={editorLabels(t)}
      />

      <Card>
        <CardHeader
          icon={<ClockCounterClockwise size={17} weight="bold" />}
          title={t("cms.revisions.title")}
        />
        <CardBody>
          {revisions.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("cms.revisions.empty")}</p>
          ) : (
            <RevisionList
              revisions={revisions.map((revision) => ({
                id: revision.id,
                when: formatDateTime(revision.createdAt, timezone, locale),
              }))}
              restoreLabel={t("cms.revisions.restore")}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
