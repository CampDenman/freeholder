// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The approval inbox (C4.04): every parked managed write, decided in one
// place, exactly once. Approving runs the stored input verbatim under the
// approver's own permissions; rejecting requires a note the record keeps.
import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { formatDateTime } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { listApprovals } from "@/core/agents/writes";
import { approveWriteAction, rejectWriteAction } from "../../../approval-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ApprovalInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("agents");
  const [t, business, approvals, query] = await Promise.all([
    getT(),
    currentBusiness(),
    listApprovals.call({ limit: 100 }, actor),
    searchParams,
  ]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const pending = approvals.filter((row) => row.status === "pending");
  const decided = approvals.filter((row) => row.status !== "pending").slice(0, 20);
  const when = (value: Date | string | null) =>
    value ? formatDateTime(new Date(value), locale, timezone) : "";

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/work" className="text-sm text-ink-muted">{t("work.approvals.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("work.approvals")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("work.approvals.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t(`work.approvals.saved.${query.saved === "rejected" ? "rejected" : "approved"}`)}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {t("work.approvals.error")} <span className="font-mono text-xs">{query.error}</span>
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("work.approvals.pending")} />
        <CardBody>
          {pending.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("work.approvals.empty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {pending.map((item) => (
                <li key={item.id} className="grid gap-3 rounded-md border border-rule px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="warning">{t(`work.approval.kind.${item.kind}`)}</Pill>
                    <Pill>{t(`work.approval.mode.${item.proposedAutonomy}`)}</Pill>
                    <span className="text-sm font-semibold">{item.summary}</span>
                    <span className="ms-auto font-mono text-xs text-ink-muted">{item.serviceName}</span>
                  </div>
                  <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-xs text-ink-muted">
                    {JSON.stringify(item.preview, null, 2)}
                  </pre>
                  <p className="text-xs text-ink-muted">
                    <Link href={`/admin/work/${item.taskId}`} className="underline">
                      {t("work.approvals.task")}
                    </Link>
                    {item.expiresAt ? <> · {t("work.approvals.expires", { date: when(item.expiresAt) })}</> : null}
                  </p>
                  <div className="flex flex-wrap items-end gap-4">
                    <form action={approveWriteAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={item.id} />
                      <label className="grid gap-1 text-sm">
                        <span className="text-ink-muted">{t("work.approvals.note")}</span>
                        <input
                          name="note"
                          maxLength={2000}
                          className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
                        />
                      </label>
                      <Button type="submit">{t("work.approvals.approve")}</Button>
                    </form>
                    <form action={rejectWriteAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={item.id} />
                      <label className="grid gap-1 text-sm">
                        <span className="text-ink-muted">{t("work.approvals.rejectNote")}</span>
                        <input
                          name="note"
                          required
                          maxLength={2000}
                          className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
                        />
                      </label>
                      <Button type="submit" variant="danger">
                        {t("work.approvals.reject")}
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("work.approvals.decided")} />
        <CardBody>
          {decided.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("work.approvals.decidedEmpty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0 text-sm">
              {decided.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  <Pill
                    tone={
                      item.status === "approved"
                        ? "success"
                        : item.status === "rejected"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {t(`work.approvals.status.${item.status}`)}
                  </Pill>
                  <span>{item.summary}</span>
                  <span className="font-mono text-xs text-ink-muted">{item.serviceName}</span>
                  <span className="ms-auto text-xs text-ink-muted">{when(item.decidedAt)}</span>
                  {item.decisionNote ? (
                    <span className="w-full text-xs text-ink-muted">{item.decisionNote}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
