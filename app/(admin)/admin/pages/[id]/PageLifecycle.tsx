// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Preview links, schedule and approval for one page (C2.02).
import { CalendarBlank, LinkSimple, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import {
  decideApprovalAction,
  requestApprovalAction,
  revokePreviewLinkAction,
  schedulePageAction,
} from "../../../cms-actions";
import { CopyPreviewLink } from "./CopyPreviewLink";

function localInput(value: Date | null): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function PageLifecycle({
  page,
  links,
  labels,
}: {
  page: {
    id: string;
    approvalState: "none" | "pending" | "approved" | "rejected";
    approvalNote: string | null;
    scheduledPublishAt: Date | null;
    scheduledUnpublishAt: Date | null;
    editLeaseHeldBy?: string;
  };
  links: { id: string; expiresAt: string; revoked: boolean }[];
  labels: {
    schedule: string;
    publishAt: string;
    unpublishAt: string;
    saveSchedule: string;
    approval: string;
    requestApproval: string;
    approve: string;
    reject: string;
    note: string;
    previewLinks: string;
    createLink: string;
    copied: string;
    revoke: string;
    expires: string;
    revoked: string;
    approvalNone: string;
    approvalPending: string;
    approvalApproved: string;
    approvalRejected: string;
    leaseHeld: string;
  };
}) {
  const tone =
    page.approvalState === "approved"
      ? "success"
      : page.approvalState === "pending"
        ? "warning"
        : page.approvalState === "rejected"
          ? "danger"
          : "neutral";
  const approvalLabel = {
    none: labels.approvalNone,
    pending: labels.approvalPending,
    approved: labels.approvalApproved,
    rejected: labels.approvalRejected,
  }[page.approvalState];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader
          icon={<CalendarBlank size={17} weight="bold" />}
          title={labels.schedule}
        />
        <CardBody>
          {page.editLeaseHeldBy ? (
            <p className="text-sm text-warning">{labels.leaseHeld}</p>
          ) : null}
          <form action={schedulePageAction} className="grid gap-3">
            <input type="hidden" name="id" value={page.id} />
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{labels.publishAt}</span>
              <input
                type="datetime-local"
                name="publishAt"
                defaultValue={localInput(page.scheduledPublishAt)}
                className="rounded-md border border-rule bg-surface px-3 py-2 text-ink"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-ink-muted">{labels.unpublishAt}</span>
              <input
                type="datetime-local"
                name="unpublishAt"
                defaultValue={localInput(page.scheduledUnpublishAt)}
                className="rounded-md border border-rule bg-surface px-3 py-2 text-ink"
              />
            </label>
            <button
              type="submit"
              className="w-fit rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
            >
              {labels.saveSchedule}
            </button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<SealCheck size={17} weight="bold" />}
          title={labels.approval}
          status={<Pill tone={tone}>{approvalLabel}</Pill>}
        />
        <CardBody>
          {page.approvalNote ? (
            <p className="text-sm text-ink-muted">{page.approvalNote}</p>
          ) : null}
          {page.approvalState === "pending" ? (
            <div className="flex flex-wrap gap-3">
              <form action={decideApprovalAction}>
                <input type="hidden" name="id" value={page.id} />
                <input type="hidden" name="approved" value="true" />
                <button
                  type="submit"
                  className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
                >
                  {labels.approve}
                </button>
              </form>
              <form action={decideApprovalAction}>
                <input type="hidden" name="id" value={page.id} />
                <input type="hidden" name="approved" value="false" />
                <button
                  type="submit"
                  className="rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
                >
                  {labels.reject}
                </button>
              </form>
            </div>
          ) : (
            <form action={requestApprovalAction} className="grid gap-3">
              <input type="hidden" name="id" value={page.id} />
              <label className="grid gap-1 text-sm">
                <span className="text-ink-muted">{labels.note}</span>
                <input
                  type="text"
                  name="note"
                  className="rounded-md border border-rule bg-surface px-3 py-2 text-ink"
                />
              </label>
              <button
                type="submit"
                className="w-fit rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
              >
                {labels.requestApproval}
              </button>
            </form>
          )}
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          icon={<LinkSimple size={17} weight="bold" />}
          title={labels.previewLinks}
        />
        <CardBody>
          <CopyPreviewLink
            pageId={page.id}
            createLabel={labels.createLink}
            copiedLabel={labels.copied}
          />
          {links.length > 0 ? (
            <ol className="grid list-none gap-0 p-0">
              {links.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-wrap items-center gap-3 border-b border-rule py-2.5 last:border-b-0"
                >
                  <span className="font-mono text-xs text-ink-muted tabular-nums">
                    {link.revoked
                      ? labels.revoked
                      : `${labels.expires} ${link.expiresAt}`}
                  </span>
                  {link.revoked ? null : (
                    <form action={revokePreviewLinkAction} className="ms-auto">
                      <input type="hidden" name="linkId" value={link.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
                      >
                        {labels.revoke}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
