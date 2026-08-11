// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOutboxEvent } from "@/core/events/outbox-service";
import { formatDateTime } from "@/core/i18n";
import { hasModuleAccess, ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { JobActionForm } from "../../JobActionForm";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("outbox.detail.title"), robots: { index: false, follow: false } };
}

function statusTone(status: string) {
  if (status === "dead_letter") return "danger" as const;
  if (status === "pending" || status === "processing") return "warning" as const;
  return "success" as const;
}

export default async function OutboxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaffActor("platform");
  const { id } = await params;
  let event: Awaited<ReturnType<typeof getOutboxEvent.call>>;
  try {
    event = await getOutboxEvent.call({ id }, actor);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }
  const [t, business] = await Promise.all([getT(), currentBusiness()]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "platform", "manage");
  const stepUpValid = actor.kind === "user" && Boolean(actor.security?.stepUpValid);
  const format = (value: Date | null | undefined) =>
    value ? formatDateTime(value, timezone, locale) : t("common.emptyValue");

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/jobs/outbox" className="text-sm text-ink-muted">{t("outbox.detail.back")}</a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-lg font-bold tracking-tight">{event.eventName}</h1>
          <Pill tone={statusTone(event.status)}>{t(`outbox.status.${event.status}`)}</Pill>
        </div>
        <p className="mt-1 font-mono text-xs text-ink-muted">{event.id}</p>
      </div>

      <Card>
        <CardHeader title={t("outbox.detail.facts")} />
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="font-mono text-xs text-ink-muted">{t("outbox.attempts")}</dt><dd>{event.attempts}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("outbox.replays")}</dt><dd>{event.replayCount}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("outbox.created")}</dt><dd>{format(event.createdAt)}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("outbox.nextAttempt")}</dt><dd>{format(event.nextAttemptAt)}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("outbox.deadLettered")}</dt><dd>{format(event.deadLetteredAt)}</dd></div>
            <div><dt className="font-mono text-xs text-ink-muted">{t("outbox.dispatched")}</dt><dd>{format(event.dispatchedAt)}</dd></div>
          </dl>
          {event.lastError ? <pre className="whitespace-pre-wrap break-words rounded-md bg-danger-soft p-3 font-mono text-xs text-danger">{event.lastError}</pre> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("outbox.detail.listeners")} status={<Pill>{event.deliveries.length}</Pill>} />
        <CardBody>
          {event.deliveries.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("outbox.detail.noListeners")}</p>
          ) : (
            <div className="grid gap-3">
              {event.deliveries.map((delivery) => (
                <div key={delivery.listenerId} className="rounded-md border border-rule p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{delivery.listenerId}</span>
                    <Pill tone={statusTone(delivery.status)}>{t(`outbox.delivery.${delivery.status}`)}</Pill>
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">{t("outbox.detail.listenerAttempts", { count: delivery.attempts })}</p>
                  {delivery.lastError ? <p className="mt-2 whitespace-pre-wrap font-mono text-xs text-danger">{delivery.lastError}</p> : null}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("outbox.detail.payload")} status={<Pill>{t("jobs.detail.redacted")}</Pill>} />
        <CardBody>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-3 font-mono text-xs">{JSON.stringify(event.payload, null, 2)}</pre>
        </CardBody>
      </Card>

      {canManage && event.status === "dead_letter" ? (
        <Card>
          <CardHeader title={t("outbox.actions.title")} />
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">{t("outbox.actions.intro")}</p>
            {!stepUpValid ? (
              <a className="text-sm font-semibold text-accent underline" href={`/security/verify?returnTo=/admin/jobs/outbox/${id}`}>
                {t("outbox.actions.stepUp")}
              </a>
            ) : null}
            <JobActionForm
              intent="replay"
              hidden={{ id }}
              submitLabel={t("outbox.actions.replay")}
              pendingLabel={t("jobs.working")}
              variant="danger"
              disabled={!stepUpValid}
            >
              <Field label={t("jobs.actions.confirmation")} htmlFor="outbox-replay-confirm" hint={t("outbox.actions.replayHint")}>
                <Input id="outbox-replay-confirm" name="confirmation" required pattern="REPLAY" autoComplete="off" />
              </Field>
            </JobActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
