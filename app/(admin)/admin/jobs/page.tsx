// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner background-work ledger and recovery queue (MASTER.md §43 C1.10).
import type { Metadata } from "next";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { DEAD_LETTER_QUEUE, type JobState } from "@/core/jobs";
import {
  getJobSummary,
  listJobQueues,
  listJobRuns,
} from "@/core/jobs/service";
import { outboxSummary } from "@/core/events/outbox-service";
import { currentBusiness } from "@/core/settings/read";
import { Callout, Card, CardBody, CardHeader, Field, Pill, Select } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("jobs.title"), robots: { index: false, follow: false } };
}

const PAGE_SIZE = 50;
const STATES: JobState[] = [
  "created",
  "retry",
  "active",
  "completed",
  "cancelled",
  "failed",
];

function statusTone(state: string, stuck: boolean) {
  if (stuck || state === "failed") return "danger" as const;
  if (state === "retry") return "warning" as const;
  if (state === "completed") return "success" as const;
  if (state === "active") return "accent" as const;
  return "neutral" as const;
}

function activityTime(job: {
  completedOn: Date | null;
  heartbeatOn: Date | null;
  startedOn: Date | null;
  createdOn: Date;
}) {
  return job.completedOn ?? job.heartbeatOn ?? job.startedOn ?? job.createdOn;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("platform");
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const rawName = one("name");
  const rawState = one("state");
  const state = STATES.includes(rawState as JobState) ? rawState as JobState : undefined;
  const offset = Math.max(0, Number(one("offset")) || 0);
  const [t, business, summary, queues, eventSummary] = await Promise.all([
    getT(),
    currentBusiness(),
    getJobSummary.call({}, actor),
    listJobQueues.call({}, actor),
    outboxSummary.call({}, actor),
  ]);
  const name = queues.includes(rawName) ? rawName : undefined;
  const result = await listJobRuns.call(
    { name, state, limit: PAGE_SIZE, offset },
    actor,
  );
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const needsAttention =
    summary.failed + summary.deadLetters + summary.stuck + eventSummary.deadLetters;
  const rail = [
    ["queued", summary.queued, "border-ink-muted"],
    ["active", summary.active, "border-accent"],
    ["completed", summary.completed, "border-success"],
    ["failed", summary.failed, "border-danger"],
    ["deadLetters", summary.deadLetters, "border-danger"],
    ["stuck", summary.stuck, "border-warning"],
  ] as const;
  const pageHref = (nextOffset: number) => {
    const query = new URLSearchParams();
    if (name) query.set("name", name);
    if (state) query.set("state", state);
    query.set("offset", String(nextOffset));
    return `?${query}`;
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("jobs.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{t("jobs.intro")}</p>
      </div>

      {needsAttention > 0 ? (
        <Callout
          tone={summary.deadLetters > 0 || summary.stuck > 0 ? "danger" : "warning"}
          icon={<WarningCircle size={17} weight="fill" />}
        >
          {t("jobs.attention", { count: needsAttention })}
        </Callout>
      ) : null}

      <Card>
        <CardHeader
          title={t("outbox.card.title")}
          status={
            <Pill tone={eventSummary.deadLetters > 0 ? "danger" : "success"}>
              {eventSummary.deadLetters}
            </Pill>
          }
        />
        <CardBody>
          <p className="text-sm text-ink-muted">{t("outbox.card.body")}</p>
          <a className="text-sm font-semibold text-accent underline" href="/admin/jobs/outbox">
            {t("outbox.card.link")}
          </a>
        </CardBody>
      </Card>

      <section aria-labelledby="jobs-state-title">
        <h2 id="jobs-state-title" className="sr-only">{t("jobs.stateRail")}</h2>
        <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-rule bg-surface sm:grid-cols-3 lg:grid-cols-6">
          {rail.map(([key, count, border]) => (
            <div key={key} className={`border-t-4 ${border} px-4 py-3 not-last:border-e not-last:border-rule`}>
              <dt className="font-mono text-[0.68rem] uppercase tracking-wide text-ink-muted">
                {t(`jobs.summary.${key}`)}
              </dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Card>
        <CardHeader title={t("jobs.runs")} status={<Pill>{result.total}</Pill>} />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field label={t("jobs.queue")} htmlFor="jobs-queue-filter">
              <Select id="jobs-queue-filter" name="name" defaultValue={name ?? ""}>
                <option value="">{t("jobs.queue.all")}</option>
                {queues.map((queue) => (
                  <option key={queue} value={queue}>
                    {queue === DEAD_LETTER_QUEUE ? t("jobs.queue.deadLetter") : queue}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("jobs.status")} htmlFor="jobs-state-filter">
              <Select id="jobs-state-filter" name="state" defaultValue={state ?? ""}>
                <option value="">{t("jobs.status.all")}</option>
                {STATES.map((value) => (
                  <option key={value} value={value}>{t(`jobs.status.${value}`)}</option>
                ))}
              </Select>
            </Field>
            <button className="rounded-md border border-rule px-4 py-2 text-sm font-semibold" type="submit">
              {t("common.filter")}
            </button>
          </form>

          {result.items.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("jobs.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-3xl border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule">
                    <th className="px-3 py-2 text-start">{t("jobs.queue")}</th>
                    <th className="px-3 py-2 text-start">{t("jobs.status")}</th>
                    <th className="px-3 py-2 text-start">{t("jobs.retries")}</th>
                    <th className="px-3 py-2 text-start">{t("jobs.updated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((job) => (
                    <tr key={`${job.name}:${job.id}`} className="border-b border-rule last:border-0">
                      <td className="px-3 py-3">
                        <a className="font-mono text-xs font-semibold underline" href={`/admin/jobs/${encodeURIComponent(job.name)}/${job.id}`}>
                          {job.name === DEAD_LETTER_QUEUE ? t("jobs.queue.deadLetter") : job.name}
                        </a>
                        {job.sourceName ? <span className="mt-1 block font-mono text-xs text-ink-muted">← {job.sourceName}</span> : null}
                      </td>
                      <td className="px-3 py-3">
                        <Pill tone={statusTone(job.state, job.stuck)}>
                          {t(job.stuck ? "jobs.status.stuck" : `jobs.status.${job.state}`)}
                        </Pill>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs tabular-nums">
                        {job.retryCount} / {job.retryLimit}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs tabular-nums">
                        {formatDateTime(activityTime(job), timezone, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-3 text-sm">
            {offset > 0 ? <a className="underline" href={pageHref(Math.max(0, offset - PAGE_SIZE))}>{t("common.previous")}</a> : null}
            {offset + result.items.length < result.total ? <a className="underline" href={pageHref(offset + PAGE_SIZE)}>{t("common.next")}</a> : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
