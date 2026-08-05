// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Doctor, in the admin (MASTER.md §17).
//
// The same report the CLI prints and the recipe matrix asserts on, because it
// is the same service. An owner should not have to open a terminal to find out
// that their bucket stopped accepting uploads.
import type { Metadata } from "next";
import {
  CheckCircle,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { doctor } from "@/core/doctor/service";
import { currentBusiness } from "@/core/settings/read";
import { Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function HealthPage() {
  const actor = await requireStaffActor();
  const [report, business, t] = await Promise.all([
    doctor.call({}, actor),
    currentBusiness(),
    getT(),
  ]);

  const icon = {
    ok: <CheckCircle size={17} weight="fill" className="text-success" />,
    warn: <WarningCircle size={17} weight="fill" className="text-warning" />,
    fail: <XCircle size={17} weight="fill" className="text-danger" />,
  };
  const tone = { ok: "success", warn: "warning", fail: "danger" } as const;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("doctor.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {t("doctor.intro")}
        </p>
      </div>

      <Callout tone={tone[report.verdict]} icon={icon[report.verdict]}>
        {t(`doctor.${report.verdict}`)}
      </Callout>

      <Card>
        <CardHeader
          title={t("doctor.ranAt")}
          status={
            <Pill tone="neutral">
              {formatDateTime(
                new Date(report.ranAt),
                business?.timezone ?? "UTC",
                business?.defaultLocale ?? "en",
              )}
            </Pill>
          }
        />
        <CardBody>
          <ul className="grid list-none gap-4 p-0">
            {report.checks.map((check) => (
              <li key={check.id} className="grid gap-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {icon[check.verdict]}
                  {check.title}
                </span>
                <span className="max-w-prose text-sm text-ink-muted">
                  {check.detail}
                </span>
                {check.remedy ? (
                  <span className="max-w-prose text-sm text-ink">
                    <span className="font-medium">{t("doctor.remedy")}: </span>
                    {check.remedy}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
