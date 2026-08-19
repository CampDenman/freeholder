// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { listImports } from "@/core/import/service";
import { StartImportForm } from "./ImportForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ImportsPage() {
  const actor = await requireStaffActor("platform");
  const [t, runs] = await Promise.all([getT(), listImports.call({}, actor)]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("imports.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("imports.intro")}</p>
      </div>

      <Card>
        <CardHeader title={t("imports.start")} />
        <CardBody>
          <StartImportForm
            labels={{
              origin: t("imports.origin"),
              kind: t("imports.kind"),
              kinds: [
                { value: "html", label: t("imports.kind.html") },
                { value: "sitemap", label: t("imports.kind.sitemap") },
                { value: "rss", label: t("imports.kind.rss") },
                { value: "atom", label: t("imports.kind.atom") },
                { value: "wordpress-rest", label: t("imports.kind.wordpress-rest") },
                { value: "wordpress-wxr", label: t("imports.kind.wordpress-wxr") },
              ],
              submit: t("imports.start"),
              error: t("imports.error"),
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("imports.runs")} />
        <CardBody>
          {runs.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("imports.empty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link href={`/admin/imports/${run.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                    <Pill tone="neutral">{t(`imports.status.${run.status}`)}</Pill>
                    <span>{run.source}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
