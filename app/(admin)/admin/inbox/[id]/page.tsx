// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One thread, and the four things you can do to it (C7.09, MASTER.md §4.14).
//
// Assign, snooze, close, reply. No formatting toolbar, no signature editor, no
// attachment picker — this is the screen where somebody answers a customer and
// gets on with their day, and every control that is not one of those four is a
// control that makes that slower.
//
// The reply box does not ask which channel to use: the thread knows, because
// the person who texted expects a text (C7.09's reply context). If nothing can
// send on that channel yet, the service refuses and says so rather than
// recording words the customer never saw.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { getConversation } from "@/core/messaging/service";
import { listRoleUsers } from "@/core/roles/service";
import { formatDateTime } from "@/core/i18n";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { domainOrNull } from "../../../read-helpers";
import {
  assignConversationAction,
  markConversationReadAction,
  replyAction,
  setConversationStatusAction,
  snoozeConversationAction,
} from "../../../inbox-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const CHANNEL_TONES: Record<string, Tone> = {
  form: "neutral",
  email: "accent",
  sms: "success",
  mms: "success",
  chat: "accent",
  assistant: "warning",
  social: "neutral",
};

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("crm");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [t, business, thread, staff] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(getConversation.call({ id }, actor)),
    domainOrNull(listRoleUsers.call({}, actor)),
  ]);
  if (!thread) notFound();

  const locale = business?.defaultLocale ?? "en";
  const timezone = business?.timezone ?? "UTC";
  const closed = thread.status === "closed";

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/inbox" className="text-sm text-ink-muted">
          {t("inbox.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">
          {thread.contactName ?? t("inbox.someone")}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <a href={`/admin/contacts/${thread.contactId}`} className="underline">
            {t("inbox.theirRecord")}
          </a>
          <Pill tone={closed ? "neutral" : "accent"}>
            {t(`conversations.status.${thread.status}`)}
          </Pill>
          {thread.subject ? <span>{thread.subject}</span> : null}
        </p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("inbox.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error.includes(" ") ? query.error : t("inbox.failed")}
        </p>
      ) : null}

      {thread.assistantEscalatedAt && !thread.assistantEscalationResolvedAt ? (
        <aside className="grid max-w-prose gap-1 rounded-md border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">
          <p className="font-semibold">{t("inbox.assistantNeedsYou")}</p>
          {thread.assistantEscalationReason ? <p>{thread.assistantEscalationReason}</p> : null}
        </aside>
      ) : null}

      {/* The four verbs, in one row, so working a thread is one screen. */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-rule p-3 text-sm">
        <form action={assignConversationAction} className="flex items-end gap-2">
          <input type="hidden" name="id" value={thread.id} />
          <label className="grid gap-1">
            <span className="text-ink-muted">{t("inbox.assignee")}</span>
            <select
              name="userId"
              defaultValue={thread.assigneeUserId ?? ""}
              className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
            >
              <option value="">{t("inbox.nobody")}</option>
              {(staff ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.email}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="quiet">
            {t("inbox.action.assign")}
          </Button>
        </form>

        <form action={snoozeConversationAction} className="flex items-end gap-2">
          <input type="hidden" name="id" value={thread.id} />
          <label className="grid gap-1">
            <span className="text-ink-muted">{t("inbox.until")}</span>
            <input
              type="date"
              name="until"
              className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
            />
          </label>
          <Button type="submit" variant="quiet">
            {t("inbox.action.snooze")}
          </Button>
        </form>

        <form action={setConversationStatusAction}>
          <input type="hidden" name="id" value={thread.id} />
          <input type="hidden" name="status" value={closed ? "open" : "closed"} />
          <Button type="submit" variant="quiet">
            {closed ? t("inbox.action.reopen") : t("inbox.action.close")}
          </Button>
        </form>

        <form action={markConversationReadAction}>
          <input type="hidden" name="id" value={thread.id} />
          <input type="hidden" name="read" value={thread.unread ? "true" : "false"} />
          <Button type="submit" variant="quiet">
            {thread.unread ? t("inbox.action.markRead") : t("inbox.action.markUnread")}
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader title={t("inbox.thread")} />
        <CardBody>
          <ol className="grid list-none gap-2 p-0">
            {thread.messages.map((message) => (
              <li
                key={message.id}
                className="grid gap-1 rounded-md border border-rule p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <Pill tone={CHANNEL_TONES[message.channel] ?? "neutral"}>
                    {t(`conversations.channel.${message.channel}`)}
                  </Pill>
                  <span>
                    {message.direction === "inbound"
                      ? t("conversations.fromThem")
                      : t("conversations.fromUs")}
                  </span>
                  <time dateTime={message.occurredAt.toISOString()} className="tabular-nums">
                    {formatDateTime(message.occurredAt, timezone, locale)}
                  </time>
                  {/* What the carrier said, not what was hoped. */}
                  {message.deliveries.length > 0 ? (
                    <span>
                      {t(
                        `conversations.delivery.${message.deliveries[message.deliveries.length - 1]!.status}`,
                      )}
                      {message.deliveries[message.deliveries.length - 1]!.errorCode
                        ? ` (${message.deliveries[message.deliveries.length - 1]!.errorCode})`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap">{message.body}</p>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("inbox.replyBy", {
            channel: t(`conversations.channel.${thread.replyChannel}`),
          })}
        />
        <CardBody>
          <form action={replyAction} className="grid gap-2">
            <input type="hidden" name="id" value={thread.id} />
            <label className="grid gap-1 text-sm">
              <span className="sr-only">{t("inbox.reply")}</span>
              <textarea
                name="body"
                rows={5}
                required
                className="w-full rounded-md border border-rule bg-field px-2 py-1 text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="close" defaultChecked />
                <span className="text-ink-muted">{t("inbox.closeWithReply")}</span>
              </label>
              <Button type="submit">{t("inbox.action.send")}</Button>
            </div>
          </form>
          {/* The thread decides the channel; nobody has to choose. */}
          <p className="max-w-prose text-sm text-ink-muted">{t("inbox.replyHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
