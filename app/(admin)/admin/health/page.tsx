// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { listCspViolations } from "@/core/security/csp-reports";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function HealthPage() {
  const actor = await requireStaffActor("platform");
  const [report, business, violations, t] = await Promise.all([
    doctor.call({}, actor),
    currentBusiness(),
    listCspViolations.call({ days: 7, limit: 20 }, actor),
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

      <Card>
        <CardHeader title={t("csp.violations.title")} />
        <CardBody>
          <p className="mb-4 max-w-prose text-sm text-ink-muted">
            {t("csp.violations.intro")}
          </p>
          {violations.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("csp.violations.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {violations.map((violation) => (
                <li
                  key={violation.fingerprint}
                  className="grid gap-1 border-b border-rule pb-4 last:border-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={violation.disposition === "enforce" ? "warning" : "neutral"}>
                      {violation.effectiveDirective}
                    </Pill>
                    <span className="font-mono text-xs text-ink">
                      {violation.documentPath}
                    </span>
                    <span className="ms-auto text-xs text-ink-muted">
                      {t("csp.violations.count", { count: violation.occurrences })}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-ink-muted">
                    {t("csp.violations.blocked", { source: violation.blockedSource })}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {t("csp.violations.lastSeen", {
                      value: formatDateTime(
                        violation.lastAt,
                        business?.timezone ?? "UTC",
                        business?.defaultLocale ?? "en",
                      ),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
