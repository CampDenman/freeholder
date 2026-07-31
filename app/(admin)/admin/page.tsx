// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The overview. Real numbers from the spine and the real audit trail — a
// dashboard of invented figures teaches an owner to distrust the screen.
import { Users } from "@phosphor-icons/react/dist/ssr";
import { contactStats } from "@/core/contacts/service";
import { recentActivity } from "@/core/events/service";
import { formatDateTime, type Translate } from "@/core/i18n";
import { getBusiness } from "@/core/settings/service";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../i18n";
import { requireStaffActor } from "./guard";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

/** "contacts.create" → "Contact created", for someone who did not build this. */
function describe(action: string): string {
  const [subject, verb] = action.split(".");
  if (!subject || !verb) return action;
  const readable = verb
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  const noun = subject.replace(/s$/, "");
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} — ${readable}`;
}

function actorLabel(actor: string, t: Translate): string {
  if (actor.startsWith("agent:")) return t("actor.agent", { name: actor.slice(6) });
  if (actor.startsWith("user:")) return t("actor.staff");
  if (actor === "system") return t("actor.system");
  return t("actor.visitor");
}

export default async function AdminOverviewPage() {
  // Its own guard, not the layout's: layouts and pages render in parallel, so
  // this must not assume anybody has vetted the caller yet.
  const actor = await requireStaffActor();
  const [business, stats, activity, t] = await Promise.all([
    getBusiness.call({}, ANONYMOUS),
    contactStats.call({}, actor),
    recentActivity.call({ limit: 12 }, actor),
    getT(),
  ]);

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
                    {describe(entry.action)}
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
