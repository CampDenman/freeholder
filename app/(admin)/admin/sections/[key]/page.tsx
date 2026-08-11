// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Editing the chrome. The same editor as a page, with the chrome palette —
// which is the whole point of deriving the palette per context.
import { notFound } from "next/navigation";
import { getSection } from "@/modules/cms/service";
import { listAssets } from "@/core/media/service";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { editorBlockTypes, editorLabels } from "../../editorLabels";
import { SectionEditor } from "./SectionEditor";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function EditSectionPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const actor = await requireStaffActor("cms", "manage");
  const { key } = await params;
  const [section, library, t] = await Promise.all([
    getSection.call({ key }, ANONYMOUS),
    listAssets.call({ kind: "image" }, actor),
    getT(),
  ]);
  if (!section) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/sections" className="text-sm text-ink-muted">
          {t("cms.sections.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{section.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("cms.sections.editIntro")}</p>
      </div>
      <SectionEditor
        sectionKey={section.key}
        initialBlocks={section.blocks as BlockNode[]}
        blockTypes={editorBlockTypes(
          t,
          "chrome",
          library.rows.map((a) => ({ id: a.id, filename: a.filename })),
        )}
        labels={editorLabels(t)}
      />
    </div>
  );
}
