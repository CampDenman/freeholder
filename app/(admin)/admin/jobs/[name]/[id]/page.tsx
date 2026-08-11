// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDateTime } from "@/core/i18n";
import { DEAD_LETTER_QUEUE } from "@/core/jobs";
import { getJobRun } from "@/core/jobs/service";
import { hasModuleAccess, ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { JobActionForm } from "../../JobActionForm";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("jobs.detail.title")} · ${t("jobs.title")}`,
    robots: { index: false, follow: false },
  };
}

function statusTone(state: string, stuck: boolean) {
  if (stuck || state === "failed") return "danger" as const;
  if (state === "retry") return "warning" as const;
  if (state === "completed") return "success" as const;
  if (state === "active") return "accent" as const;
  return "neutral" as const;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ name: string; id: string }>;
}) {
  const actor = await requireStaffActor("platform");
  const { name, id } = await params;
  let job: Awaited<ReturnType<typeof getJobRun.call>>;
  try {
    job = await getJobRun.call({ name, id }, actor);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }
  const [t, business] = await Promise.all([getT(), currentBusiness()]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "platform", "manage");
  const stepUpValid = actor.kind === "user" && Boolean(actor.security?.stepUpValid);
  const canCancel = ["created", "retry", "active"].includes(job.state);
  const canRetry = ["failed", "cancelled"].includes(job.state) && name !== DEAD_LETTER_QUEUE;
  const canRedrive = name === DEAD_LETTER_QUEUE && Boolean(job.sourceName);
  const format = (value: Date | null | undefined) =>
    value ? formatDateTime(value, timezone, locale) : t("common.emptyValue");
  const lifecycle = [
    ["created", job.createdOn],
    ["started", job.startedOn],
    ["heartbeat", job.heartbeatOn],
    ["completed", job.completedOn],
  ] as const;

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/jobs" className="text-sm text-ink-muted">{t("jobs.back")}</a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-lg font-bold tracking-tight">{job.name}</h1>
          <Pill tone={statusTone(job.state, job.stuck)}>
            {t(job.stuck ? "jobs.status.stuck" : `jobs.status.${job.state}`)}
          </Pill>
        </div>
        <p className="mt-1 font-mono text-xs text-ink-muted">{job.id}</p>
      </div>

      <Card>
        <CardHeader title={t("jobs.detail.lifecycle")} />
        <CardBody>
          <ol className="grid list-none gap-0 p-0 sm:grid-cols-4">
            {lifecycle.map(([key, value], index) => (
              <li key={key} className="relative border-s-2 border-rule pb-5 ps-4 last:pb-0 sm:border-s-0 sm:border-t-2 sm:pb-0 sm:ps-0 sm:pt-4">
                <span className="absolute -start-[0.43rem] top-0 size-3 rounded-full border-2 border-surface bg-accent sm:-top-[0.43rem] sm:start-0" aria-hidden="true" />
                <span className="font-mono text-[0.68rem] uppercase tracking-wide text-ink-muted">
                  {index + 1}. {t(`jobs.lifecycle.${key}`)}
                </span>
                <span className="mt-1 block text-sm">{format(value)}</span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("jobs.detail.facts")} />
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.queue")}</dt><dd>{job.name}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.detail.sourceQueue")}</dt><dd>{job.sourceName ?? t("common.emptyValue")}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.detail.sourceId")}</dt><dd className="break-all font-mono text-xs">{job.sourceId ?? t("common.emptyValue")}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.retries")}</dt><dd>{job.retryCount} / {job.retryLimit}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.detail.lease")}</dt><dd>{t("jobs.seconds", { count: job.expireInSeconds })}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.detail.keepUntil")}</dt><dd>{format(job.keepUntil)}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.detail.group")}</dt><dd>{job.groupId ?? t("common.emptyValue")}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.detail.priority")}</dt><dd>{job.priority}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("jobs.detail.nextAttempt")}</dt><dd>{format(job.startAfter)}</dd></div>
          </dl>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("jobs.detail.payload")} status={<Pill>{t("jobs.detail.redacted")}</Pill>} />
          <CardBody>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-3 font-mono text-xs">{JSON.stringify(job.data, null, 2)}</pre>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("jobs.detail.output")} status={<Pill>{t("jobs.detail.redacted")}</Pill>} />
          <CardBody>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-3 font-mono text-xs">{JSON.stringify(job.output, null, 2) ?? t("common.emptyValue")}</pre>
          </CardBody>
        </Card>
      </div>

      {canManage && (canCancel || canRetry || canRedrive) ? (
        <Card>
          <CardHeader title={t("jobs.actions.title")} />
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("jobs.actions.intro")}</p>
            {!stepUpValid ? (
              <a className="text-sm font-semibold text-accent underline" href={`/security/verify?returnTo=/admin/jobs/${encodeURIComponent(name)}/${id}`}>
                {t("jobs.actions.stepUp")}
              </a>
            ) : null}
            <div className="grid gap-6 lg:grid-cols-2">
              {canCancel ? (
                <JobActionForm
                  intent="cancel"
                  hidden={{ name, id }}
                  submitLabel={t("jobs.actions.cancel")}
                  pendingLabel={t("jobs.working")}
                  variant="danger"
                  disabled={!stepUpValid}
                >
                  <Field label={t("jobs.actions.confirmation")} htmlFor="job-cancel-confirm" hint={t("jobs.actions.cancelHint")}>
                    <Input id="job-cancel-confirm" name="confirmation" required pattern="CANCEL" autoComplete="off" />
                  </Field>
                </JobActionForm>
              ) : null}
              {canRetry ? (
                <JobActionForm
                  intent="retry"
                  hidden={{ name, id }}
                  submitLabel={t("jobs.actions.retry")}
                  pendingLabel={t("jobs.working")}
                  disabled={!stepUpValid}
                >
                  <Field label={t("jobs.actions.confirmation")} htmlFor="job-retry-confirm" hint={t("jobs.actions.retryHint")}>
                    <Input id="job-retry-confirm" name="confirmation" required pattern="RETRY" autoComplete="off" />
                  </Field>
                </JobActionForm>
              ) : null}
              {canRedrive ? (
                <JobActionForm
                  intent="redrive"
                  hidden={{ name, id, sourceName: job.sourceName! }}
                  submitLabel={t("jobs.actions.redrive")}
                  pendingLabel={t("jobs.working")}
                  variant="danger"
                  disabled={!stepUpValid}
                >
                  <Field label={t("jobs.actions.confirmation")} htmlFor="job-redrive-confirm" hint={t("jobs.actions.redriveHint")}>
                    <Input id="job-redrive-confirm" name="confirmation" required pattern="REDRIVE" autoComplete="off" />
                  </Field>
                </JobActionForm>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
