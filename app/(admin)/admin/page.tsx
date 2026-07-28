// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The overview. Real numbers from the spine and the real audit trail — a
// dashboard of invented figures teaches an owner to distrust the screen.
import { Users } from "@phosphor-icons/react/dist/ssr";
import { contactStats } from "@/core/contacts/service";
import { recentActivity } from "@/core/events/service";
import { formatDateTime } from "@/core/i18n";
import { getBusiness } from "@/core/settings/service";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { requireStaffActor } from "./guard";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

const STAGE_LABELS: Record<string, string> = {
  lead: "Leads",
  prospect: "Prospects",
  customer: "Customers",
  repeat: "Repeat customers",
};

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

function actorLabel(actor: string): string {
  if (actor.startsWith("agent:")) return `Agent ${actor.slice(6)}`;
  if (actor.startsWith("user:")) return "You or your staff";
  if (actor === "system") return "The platform";
  return "A visitor";
}

export default async function AdminOverviewPage() {
  // Its own guard, not the layout's: layouts and pages render in parallel, so
  // this must not assume anybody has vetted the caller yet.
  const actor = await requireStaffActor();
  const [business, stats, activity] = await Promise.all([
    getBusiness.call({}, ANONYMOUS),
    contactStats.call({}, actor),
    recentActivity.call({ limit: 12 }, actor),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Everything below is live from your own data.
        </p>
      </div>

      <Card>
        <CardHeader
          icon={<Users size={17} weight="bold" />}
          title="Contacts"
          status={<Pill tone="neutral">{stats.total} total</Pill>}
        />
        <CardBody>
          {stats.total === 0 ? (
            <p className="text-sm text-ink-muted">
              No contacts yet. They arrive on their own once forms and checkout
              are live, and you can add one by hand at any time.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Object.entries(stats.byStage).map(([stage, n]) => (
                <div key={stage} className="grid gap-1">
                  <dt className="font-mono text-xs text-ink-muted">
                    {STAGE_LABELS[stage] ?? stage}
                  </dt>
                  <dd className="text-2xl font-bold tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What changed" />
        <CardBody>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Nothing has changed yet. Every action anyone takes — you, your
              staff, or an AI agent — is recorded here.
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
                    {actorLabel(entry.actor)}
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
