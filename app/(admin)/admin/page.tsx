// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The overview. Real numbers from the spine and the real audit trail — a
// dashboard of invented figures teaches an owner to distrust the screen.
import { Users, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { contactStats } from "@/core/contacts/service";
import { recentActivity } from "@/core/events/service";
import { formatDateTime } from "@/core/i18n";
import { collapseOwnerFeed, describeAction, ownerActivityLine } from "./describeAction";
import { actorLabel } from "./actorLabel";
import { chooseFirstWin } from "@/core/guidance/first-win";
import { Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../i18n";
import { requireStaffActor } from "./guard";
import { currentBusiness } from "@/core/settings/read";
import {
  backgroundJobsBriefingContribution,
  getJobSummary,
} from "@/core/jobs/service";
import { hasModuleAccess } from "@/core/service";
import { listGuidance } from "@/core/guidance/service";
import { GuidancePanel } from "@/ui/GuidancePanel";
import { adminGuidanceAction } from "../guidance-actions";

export const dynamic = "force-dynamic";



export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string }>;
}) {
  // Its own guard, not the layout's: layouts and pages render in parallel, so
  // this must not assume anybody has vetted the caller yet.
  const actor = await requireStaffActor("admin");
  // The owner's feed is what people did; the platform's own housekeeping is
  // one click away for anyone diagnosing it, never the default.
  const includeSystem = (await searchParams).activity === "all";
  const canViewPlatform = hasModuleAccess(actor, "platform", "view");
  const canViewContacts = hasModuleAccess(actor, "contacts", "view");
  const canViewEvents = hasModuleAccess(actor, "events", "view");
  const [business, stats, rawActivity, t, jobSummary, guidance] = await Promise.all([
    currentBusiness(),
    canViewContacts ? contactStats.call({}, actor) : Promise.resolve(null),
    canViewEvents ? recentActivity.call({ limit: includeSystem ? 12 : 100, include: includeSystem ? "all" : "people" }, actor) : Promise.resolve(null),
    getT(),
    canViewPlatform ? getJobSummary.call({}, actor) : Promise.resolve(null),
    listGuidance.call({}, actor),
  ]);
  const jobsBriefing = jobSummary
    ? await backgroundJobsBriefingContribution(jobSummary)
    : null;

  // The owner's feed says each row as business news or leaves it to the full
  // log, and folds a run of the same line by the same actor into one row with
  // a count; the full log keeps every row and its service summary.
  const lines = rawActivity
    ? rawActivity
        .map((entry) => ({ ...entry, line: includeSystem ? describeAction(entry.action) : ownerActivityLine(entry, t) }))
        .filter((entry): entry is typeof entry & { line: string } => entry.line !== null)
    : null;
  const activity = lines ? (includeSystem ? lines : collapseOwnerFeed(lines, t)).slice(0, 12) : null;
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const preferredGuidance = chooseFirstWin(guidance);

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

      {preferredGuidance ? (
        <GuidancePanel
          flows={[preferredGuidance]}
          action={adminGuidanceAction}
          returnTo="/admin#guidance"
          t={t}
        />
      ) : null}

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

      {stats ? <Card>
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
      </Card> : null}

      {activity ? <Card>
        <CardHeader
          title={t("admin.overview.activity")}
          status={
            <a
              href={includeSystem ? "/admin" : "/admin?activity=all"}
              className="text-xs font-medium text-accent underline"
            >
              {includeSystem
                ? t("admin.overview.activityPeople")
                : t("admin.overview.activityAll")}
            </a>
          }
        />
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
                    {entry.line}
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
      </Card> : null}
    </div>
  );
}
