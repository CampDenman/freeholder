// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A read-only render of the exact stored before/after block trees.
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { renderBlocks } from "@/modules/cms/render";
import { parseBlockTree } from "@/modules/cms/blocks/registry";
import { getProposal } from "@/modules/builder/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../../../i18n";
import { requireOwnerActor } from "../../../guard";

export const dynamic = "force-dynamic";

type PreviewState = {
  blocks?: unknown;
  title?: string;
  name?: string;
};

type PreviewDiff = {
  target: "page" | "section" | "new_page";
  label: string;
  before: PreviewState | null;
  after: PreviewState;
};

export default async function BuilderProposalPreview({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOwnerActor("builder");
  const { id } = await params;
  const [proposal, business, t] = await Promise.all([
    getProposal.call({ id }, actor),
    currentBusiness(),
    getT(),
  ]);
  const context = {
    locale: business?.defaultLocale ?? "en",
    t,
    business: business ? {
      name: business.name,
      tagline: business.tagline,
      defaultLocale: business.defaultLocale,
      enabledLocales: business.enabledLocales,
    } : null,
    path: "/",
  };
  const diffs = proposal.diff as PreviewDiff[];

  return (
    <div className="grid gap-6">
      <div>
        <a href={`/admin/builder?proposal=${proposal.id}`} className="inline-flex items-center gap-2 text-sm text-ink-muted underline underline-offset-2">
          <ArrowLeft size={15} /> {t("builder.back")}
        </a>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{proposal.summary}</h1>
          <Pill tone="accent">{t("builder.previewOnly")}</Pill>
        </div>
        <p className="mt-2 text-sm text-ink-muted">{t("builder.previewIntro")}</p>
      </div>

      {await Promise.all(diffs.map(async (entry, index) => {
        const contextKind = entry.target === "section" ? "chrome" : "page";
        const before = entry.before?.blocks
          ? await renderBlocks(parseBlockTree(entry.before.blocks, contextKind), context)
          : null;
        const after = await renderBlocks(parseBlockTree(entry.after.blocks ?? [], contextKind), context);
        return (
          <Card key={`${entry.target}:${entry.label}:${index}`}>
            <CardHeader title={entry.label} status={<Pill>{t(`builder.target.${entry.target}`)}</Pill>} />
            <CardBody>
              <div className="grid gap-5 lg:grid-cols-2">
                <section aria-label={t("builder.before")} className="grid content-start gap-4 rounded-md border border-rule bg-paper p-5">
                  <h2 className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{t("builder.before")}</h2>
                  {before ?? <p className="text-sm text-ink-muted">{t("builder.newContent")}</p>}
                </section>
                <section aria-label={t("builder.after")} className="grid content-start gap-4 rounded-md border-2 border-accent bg-paper p-5">
                  <h2 className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-accent">{t("builder.after")}</h2>
                  {after}
                </section>
              </div>
            </CardBody>
          </Card>
        );
      }))}
    </div>
  );
}
