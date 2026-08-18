// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Experiment outcomes (C2.18).
import { experimentReport } from "@/modules/analytics/service";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  const actor = await requireStaffActor("analytics");
  const [report, t] = await Promise.all([experimentReport.call({}, actor), getT()]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("experiments.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("experiments.intro")}</p>
      </div>
      {report.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-ink-muted">{t("experiments.empty")}</p>
        </Card>
      ) : (
        report.map((experiment) => (
          <Card key={experiment.experimentKey}>
            <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">{experiment.experimentKey}</h2>
              <Pill tone={experiment.comparable ? "success" : "warning"}>
                {experiment.comparable
                  ? t("experiments.comparable")
                  : t("experiments.tooFew")}
              </Pill>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule text-start">
                  <th scope="col" className="p-3 text-start font-semibold">
                    {t("experiments.variant")}
                  </th>
                  <th scope="col" className="p-3 text-start font-semibold">
                    {t("experiments.visitors")}
                  </th>
                  <th scope="col" className="p-3 text-start font-semibold">
                    {t("experiments.conversions")}
                  </th>
                  <th scope="col" className="p-3 text-start font-semibold">
                    {t("experiments.revenue")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {experiment.variants.map((row) => (
                  <tr key={row.variant} className="border-b border-rule last:border-0">
                    <th scope="row" className="p-3 text-start font-medium">
                      {row.variant}
                    </th>
                    <td className="p-3">{row.uniqueVisitors}</td>
                    <td className="p-3">{row.conversions}</td>
                    <td className="p-3 font-mono tabular-nums">{row.revenueMinor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </div>
  );
}
