// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { hasModuleAccess } from "@/core/service";
import {
  getContributeSettings,
  getContribution,
} from "@/core/contribute/service";
import { DetermineForm } from "../ContributeForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ContributeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor("contribute");
  const { id } = await params;
  const [t, settings] = await Promise.all([
    getT(),
    getContributeSettings.call({}, actor),
  ]);
  let item;
  try {
    item = await getContribution.call({ id }, actor);
  } catch {
    notFound();
  }

  const canDetermine =
    settings.hubEnabled && hasModuleAccess(actor, "contribute", "manage");

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          <a href="/admin/contribute" className="text-accent">
            {t("contribute.title")}
          </a>
        </p>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{item.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone="neutral">{t(`contribute.kind.${item.kind}`)}</Pill>
          <Pill tone="neutral">{t(`contribute.status.${item.status}`)}</Pill>
        </div>
      </div>

      <Card>
        <CardHeader title={t("contribute.detail")} />
        <CardBody>
          <p className="whitespace-pre-wrap text-sm text-ink">{item.body}</p>
          {item.externalUrl ? (
            <p className="mt-4 text-sm">
              <a href={item.externalUrl} className="text-accent">
                {item.externalUrl}
              </a>
            </p>
          ) : null}
        </CardBody>
      </Card>

      {item.events.length > 0 ? (
        <Card>
          <CardHeader title={t("contribute.trail")} />
          <CardBody>
            <ol className="grid list-none gap-2 p-0">
              {item.events.map((event) => (
                <li key={event.id} className="text-sm text-ink-muted">
                  {event.kind}
                  {event.body ? ` — ${event.body}` : ""}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      {canDetermine ? (
        <Card>
          <CardHeader title={t("contribute.determine")} />
          <CardBody>
            <DetermineForm
              id={item.id}
              labels={{
                status: t("contribute.determine.status"),
                statuses: [
                  { value: "triage", label: t("contribute.status.triage") },
                  { value: "needs_info", label: t("contribute.status.needs_info") },
                  { value: "accepted", label: t("contribute.status.accepted") },
                  { value: "duplicate", label: t("contribute.status.duplicate") },
                  { value: "wontfix", label: t("contribute.status.wontfix") },
                  { value: "shipped", label: t("contribute.status.shipped") },
                ],
                note: t("contribute.determine.note"),
                checklistId: t("contribute.determine.checklistId"),
                parentId: t("contribute.determine.parentId"),
                save: t("contribute.determine.save"),
              }}
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
