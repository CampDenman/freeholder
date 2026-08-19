// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
            labels={{
              preview: t("imports.preview"),
              url: t("imports.pageUrl"),
              slug: t("imports.slug"),
              title: t("imports.pageTitle"),
              commit: t("imports.commit"),
              reconcile: t("imports.reconcile"),
              publish: t("imports.publish"),
              rollback: t("imports.rollback"),
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
