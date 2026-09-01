// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One campaign: start it, watch it, stop it (C9.06, MASTER.md §30).
//
// The numbers on this page are counted from `broadcast_recipients` rather than
// read from a provider's dashboard, which is what §30 means by honest
// analytics: a provider that loses a webhook makes a figure stop rising, not
// makes it wrong. That is also why the recipient list is here — "did this
// reach Nils" is a question an owner genuinely asks, and only a row can
// answer it.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import {
  broadcastRecipientList,
  broadcastStats,
  listBroadcasts,
} from "@/modules/newsletters/service";
import { getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { domainOrNull } from "../../../../read-helpers";
import {
  pauseBroadcastAction,
  resumeBroadcastAction,
  startBroadcastAction,
  testSendAction,
} from "../../../../broadcast-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TONE = {
  draft: "neutral",
  scheduled: "accent",
  sending: "accent",
  sent: "success",
  paused: "warning",
  cancelled: "neutral",
} as const;

/** Every outcome worth its own number, in the order an owner reads them. */
const FIGURES = ["sent", "pending", "failed", "suppressed", "bounced", "complained"] as const;

export default async function BroadcastPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    started?: string;
    paused?: string;
    resumed?: string;
    tested?: string;
  }>;
}) {
  const actor = await requireStaffActor("newsletters", "manage");
  const { id } = await params;
  const query = await searchParams;

  const [t, business, all] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(listBroadcasts.call({ limit: 200 }, actor)),
  ]);
  const broadcast = (all ?? []).find((each) => each.id === id);
  if (!broadcast) notFound();

  const [stats, recipients] = await Promise.all([
    domainOrNull(broadcastStats.call({ id }, actor)),
    domainOrNull(broadcastRecipientList.call({ id, limit: 200 }, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  // The business's own timezone, so "started" and "finished" read as the hours
  // the owner would say them.
  const timezone = business?.timezone ?? "UTC";
  const when = (value: Date | string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: timezone,
        }).format(new Date(value))
      : "—";

  const notStarted = broadcast.status === "draft" || broadcast.status === "scheduled";
  const running = broadcast.status === "sending";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/newsletters/broadcasts" className="text-sm underline">
          {t("broadcasts.backToList")}
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{broadcast.name}</h1>
        <Pill tone={TONE[broadcast.status]}>{t(`broadcasts.status.${broadcast.status}`)}</Pill>
      </div>

      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      {query.started ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("broadcasts.notice.started")}
        </p>
      ) : null}
      {query.tested ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("broadcasts.notice.tested")}
        </p>
      ) : null}
      {query.paused ? (
        <p className="rounded-md border border-rule bg-surface px-3 py-2 text-sm text-ink-muted">
          {t("broadcasts.notice.paused")}
        </p>
      ) : null}
      {query.resumed || query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("broadcasts.notice.saved")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("broadcasts.progress")} />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {FIGURES.map((figure) => (
              <div key={figure} className="rounded-md border border-rule p-3">
                <dt className="text-xs text-ink-muted">{t(`broadcasts.figure.${figure}`)}</dt>
                <dd className="text-lg font-semibold tabular-nums text-ink">
                  {stats?.[figure] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-ink-muted">
            {t("broadcasts.timing", {
              audience: stats?.audience ?? broadcast.audienceCount,
              started: when(broadcast.startedAt),
              finished: when(broadcast.finishedAt),
            })}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("broadcasts.sending")} />
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            {notStarted ? (
              <form action={startBroadcastAction}>
                <input type="hidden" name="id" value={broadcast.id} />
                <Button type="submit">{t("broadcasts.action.start")}</Button>
              </form>
            ) : null}
            {running ? (
              <form action={pauseBroadcastAction}>
                <input type="hidden" name="id" value={broadcast.id} />
                <Button type="submit" variant="quiet">
                  {t("broadcasts.action.pause")}
                </Button>
              </form>
            ) : null}
            {broadcast.status === "paused" ? (
              <>
                <form action={resumeBroadcastAction}>
                  <input type="hidden" name="id" value={broadcast.id} />
                  <Button type="submit">{t("broadcasts.action.resume")}</Button>
                </form>
                {/* Cancelling is separate from pausing, because the two are
                    only one careless click apart and one of them cannot be
                    undone. */}
                <form action={pauseBroadcastAction}>
                  <input type="hidden" name="id" value={broadcast.id} />
                  <input type="hidden" name="cancel" value="1" />
                  <Button type="submit" variant="quiet">
                    {t("broadcasts.action.cancel")}
                  </Button>
                </form>
              </>
            ) : null}
          </div>
          {/* Said where the button is: pressing send does not send, it starts,
              and an owner who does not know that will press it twice. */}
          <p className="mt-3 max-w-prose text-sm text-ink-muted">
            {notStarted ? t("broadcasts.startHint") : t("broadcasts.runningHint")}
          </p>
        </CardBody>
      </Card>

      {notStarted ? (
        <Card>
          <CardHeader title={t("broadcasts.test")} />
          <CardBody>
            <form action={testSendAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={broadcast.id} />
              <input type="hidden" name="templateId" value={broadcast.templateId} />
              <input type="hidden" name="subject" value={broadcast.subject ?? ""} />
              <Field label={t("broadcasts.field.testTo")} htmlFor="to">
                <Input id="to" name="to" type="email" required />
              </Field>
              <Button type="submit" variant="quiet">
                {t("broadcasts.action.test")}
              </Button>
            </form>
            <p className="mt-3 max-w-prose text-sm text-ink-muted">{t("broadcasts.testHint")}</p>
          </CardBody>
        </Card>
      ) : null}

      {(recipients ?? []).length > 0 ? (
        <Card>
          <CardHeader title={t("broadcasts.recipients")} />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-ink-muted">
                    <th className="p-2 font-normal">{t("broadcasts.column.email")}</th>
                    <th className="p-2 font-normal">{t("broadcasts.column.state")}</th>
                    <th className="p-2 font-normal">{t("broadcasts.column.detail")}</th>
                    <th className="p-2 font-normal">{t("broadcasts.column.sentAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(recipients ?? []).map((person) => (
                    <tr key={person.contactId} className="border-t border-rule">
                      <td className="p-2 font-mono text-xs">{person.email}</td>
                      <td className="p-2">{t(`broadcasts.state.${person.state}`)}</td>
                      {/* Why, not just that: an owner reading "suppressed"
                          with no reason has to go and ask the provider. */}
                      <td className="p-2 text-ink-muted">{person.detail ?? "—"}</td>
                      <td className="p-2 text-ink-muted">{when(person.sentAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
