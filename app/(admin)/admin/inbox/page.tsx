// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One unified inbox (C7.09, MASTER.md §4.14).
//
// The item says to build this "without reimplementing a mail client", which is
// a constraint rather than a caveat. A mail client holds everything you have
// ever received; this makes sure nothing waiting on a person is forgotten. So
// there are no folders and no labels — a few filters, a search over what was
// actually said, and a checkbox column for doing one thing to several threads.
//
// Filters are in the URL like every other list here (C7.06), so a view of the
// inbox is a link somebody can send to whoever should be looking at it.
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { inboxCounts, searchInbox } from "@/core/messaging/inbox";
import { listRoleUsers } from "@/core/roles/service";
import { formatDateTime } from "@/core/i18n";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { bulkConversationsAction } from "../../inbox-actions";

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

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("crm");
  const params = await searchParams;
  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const view = one("view");
  const q = one("q");

  const [t, business, threads, counts, staff] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(
      searchInbox.call(
        {
          // "Everything not finished" is what an inbox means; the other views
          // narrow from there rather than each defining their own idea of open.
          openOnly: view !== "closed",
          ...(view === "closed" ? { status: "closed" as const } : {}),
          ...(view === "mine" && actor.kind === "user" ? { assigneeUserId: actor.userId } : {}),
          ...(view === "unassigned" ? { unassigned: true } : {}),
          ...(view === "unread" ? { unreadOnly: true } : {}),
          ...(q ? { q } : {}),
          limit: 100,
        },
        actor,
      ),
    ),
    domainOrNull(inboxCounts.call({}, actor)),
    domainOrNull(listRoleUsers.call({}, actor)),
  ]);

  const locale = business?.defaultLocale ?? "en";
  const timezone = business?.timezone ?? "UTC";
  const views: Array<{ key: string; label: string; count?: number }> = [
    { key: "", label: t("inbox.view.open"), count: counts?.open },
    { key: "unread", label: t("inbox.view.unread"), count: counts?.unread },
    { key: "mine", label: t("inbox.view.mine"), count: counts?.mine },
    { key: "unassigned", label: t("inbox.view.unassigned"), count: counts?.unassigned },
    { key: "closed", label: t("inbox.view.closed") },
  ];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("inbox.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("inbox.intro")}</p>
      </div>

      {params.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("inbox.saved")}
        </p>
      ) : null}
      {params.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {one("error").includes(" ") ? one("error") : t("inbox.failed")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        {views.map((entry) => (
          <a
            key={entry.key || "open"}
            href={entry.key ? `/admin/inbox?view=${entry.key}` : "/admin/inbox"}
            className={view === entry.key ? "font-medium" : "underline"}
          >
            {entry.label}
            {entry.count !== undefined && entry.count > 0 ? (
              <span className="ms-1 tabular-nums text-ink-muted">{entry.count}</span>
            ) : null}
          </a>
        ))}
        {/* What was said, or who said it — the two things anybody remembers. */}
        <form method="get" className="ms-auto flex items-end gap-2">
          {view ? <input type="hidden" name="view" value={view} /> : null}
          <label className="grid gap-1">
            <span className="sr-only">{t("inbox.search")}</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t("inbox.search")}
              className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
            />
          </label>
          <Button type="submit" variant="quiet">
            {t("inbox.action.search")}
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader title={t("inbox.threads")} />
        <CardBody>
          {threads === null ? (
            <p className="text-sm text-danger">{t("inbox.unavailable")}</p>
          ) : threads.length === 0 ? (
            <p className="max-w-prose text-sm text-ink-muted">{t("inbox.empty")}</p>
          ) : (
            // One form around the list: the checkboxes and the action bar are
            // the same submission, which is what makes bulk work with no
            // JavaScript.
            <form action={bulkConversationsAction} className="grid gap-3">
              <ul className="grid list-none gap-2 p-0">
                {threads.map((thread) => (
                  <li
                    key={thread.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="selected"
                      value={thread.id}
                      aria-label={t("inbox.select", { who: thread.contactName ?? "" })}
                    />
                    <a
                      href={`/admin/inbox/${thread.id}`}
                      className={thread.unread ? "font-bold underline" : "underline"}
                    >
                      {thread.contactName ?? thread.contactEmail ?? t("inbox.someone")}
                    </a>
                    <Pill tone={CHANNEL_TONES[thread.replyChannel] ?? "neutral"}>
                      {t(`conversations.channel.${thread.replyChannel}`)}
                    </Pill>
                    {thread.assistantEscalatedAt && !thread.assistantEscalationResolvedAt ? (
                      <Pill tone="warning">{t("inbox.assistantNeedsYou")}</Pill>
                    ) : null}
                    {/* The last thing said, so a list of threads reads as a
                        list of things rather than a list of names. */}
                    <span className="min-w-40 grow truncate text-ink-muted">
                      {thread.preview ?? thread.subject ?? ""}
                    </span>
                    {thread.status === "snoozed" && thread.snoozedUntil ? (
                      <Pill tone="warning">
                        {t("inbox.backOn", {
                          when: formatDateTime(thread.snoozedUntil, timezone, locale),
                        })}
                      </Pill>
                    ) : null}
                    {thread.assigneeEmail ? (
                      <span className="text-xs text-ink-muted">{thread.assigneeEmail}</span>
                    ) : (
                      <Pill tone="neutral">{t("inbox.nobody")}</Pill>
                    )}
                    <time
                      dateTime={thread.updatedAt.toISOString()}
                      className="ms-auto font-mono text-xs text-ink-muted tabular-nums"
                    >
                      {formatDateTime(thread.updatedAt, timezone, locale)}
                    </time>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-end gap-3 rounded-md border border-rule p-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("inbox.bulk.do")}</span>
                  <select
                    name="action"
                    defaultValue="close"
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  >
                    {["close", "reopen", "assign", "snooze", "markRead", "markUnread"].map(
                      (action) => (
                        <option key={action} value={action}>
                          {t(`inbox.bulk.${action}`)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("inbox.bulk.who")}</span>
                  <select
                    name="userId"
                    defaultValue=""
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
                <label className="grid gap-1 text-sm">
                  <span className="text-ink-muted">{t("inbox.bulk.until")}</span>
                  <input
                    type="date"
                    name="until"
                    className="rounded-md border border-rule bg-field px-2 py-1 text-sm"
                  />
                </label>
                <Button type="submit" variant="quiet">
                  {t("inbox.bulk.apply")}
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
