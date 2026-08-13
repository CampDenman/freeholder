// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The overview. Real numbers from the spine and the real audit trail — a
// dashboard of invented figures teaches an owner to distrust the screen.
import { Users, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { contactStats } from "@/core/contacts/service";
import { recentActivity } from "@/core/events/service";
import { formatDateTime, type Translate } from "@/core/i18n";
import { describeAction } from "./describeAction";
import { Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../i18n";
import { requireStaffActor } from "./guard";
import { currentBusiness } from "@/core/settings/read";
import {
  backgroundJobsBriefingContribution,
  getJobSummary,
} from "@/core/jobs/service";
import { hasModuleAccess } from "@/core/service";

export const dynamic = "force-dynamic";



function actorLabel(actor: string, t: Translate): string {
  if (actor.startsWith("agent:")) return t("actor.agent", { name: actor.slice(6) });
  if (actor.startsWith("user:")) return t("actor.staff");
  if (actor === "system") return t("actor.system");
  return t("actor.visitor");
}

export default async function AdminOverviewPage() {
  // Its own guard, not the layout's: layouts and pages render in parallel, so
  // this must not assume anybody has vetted the caller yet.
  const actor = await requireStaffActor("admin");
  const canViewPlatform = hasModuleAccess(actor, "platform", "view");
  const [business, stats, activity, t, jobSummary] = await Promise.all([
    currentBusiness(),
    contactStats.call({}, actor),
    recentActivity.call({ limit: 12 }, actor),
    getT(),
    canViewPlatform ? getJobSummary.call({}, actor) : Promise.resolve(null),
  ]);
  const jobsBriefing = jobSummary
    ? await backgroundJobsBriefingContribution(jobSummary)
    : null;

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {t("admin.overview.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t("admin.overview.intro")}
        </p>
      </div>

      {jobsBriefing ? (
        <Callout
          tone={jobsBriefing.severity}
          icon={<WarningCircle size={17} weight="fill" />}
        >
          <div className="grid gap-1">
            <strong>{t("jobs.briefing.title")}</strong>
            <span>
              {t("jobs.attention", {
                count: jobsBriefing.items.reduce((total, item) => total + item.count, 0),
              })}
            </span>
            <a href={jobsBriefing.href} className="font-semibold">{t("jobs.briefing.link")}</a>
          </div>
        </Callout>
      ) : null}

      <Card>
        <CardHeader
          icon={<Users size={17} weight="bold" />}
          title={t("admin.overview.contacts")}
          status={
            <Pill tone="neutral">
              {t("admin.overview.contactsTotal", { count: stats.total })}
            </Pill>
          }
        />
        <CardBody>
          {stats.total === 0 ? (
            <p className="text-sm text-ink-muted">
              {t("admin.overview.contactsEmpty")}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Object.entries(stats.byStage).map(([stage, n]) => (
                <div key={stage} className="grid gap-1">
                  <dt className="font-mono text-xs text-ink-muted">
                    {t(`contacts.stagePlural.${stage}`)}
                  </dt>
                  <dd className="text-2xl font-bold tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("admin.overview.activity")} />
        <CardBody>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {t("admin.overview.activityEmpty")}
            </p>
          ) : (
            <ul className="grid list-none gap-0 p-0">
              {activity.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule py-2.5 last:border-b-0"
                >
                  <span className="text-sm font-medium">
                    {describeAction(entry.action)}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {actorLabel(entry.actor, t)}
                  </span>
                  <time
                    dateTime={entry.at.toISOString()}
                    className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                  >
                    {formatDateTime(entry.at, timezone, locale)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
