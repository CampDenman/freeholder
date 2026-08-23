// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Everything this person has said, whatever it arrived on (C7.08, §4.14).
//
// §4.14: "The inbox threads by contact, not by channel. A form submission, a
// reply to it by email, and a text message about the same job belong in one
// conversation — that is the entire promise of a spine, made visible."
//
// This is where it is made visible. The inbox itself — assigning, snoozing,
// searching, bulk actions — is C7.09; what belongs here is the answer to "what
// have we said to each other", on the record for the person it is about.
//
// Each message shows the channel it came through, because a thread that mixes a
// form, an email and a text is only readable if each line says which it was.
import { Card, CardBody, CardHeader, Pill, type Tone } from "@/ui/primitives";
import { formatDateTime } from "@/core/i18n";
import { getConversation, listConversations } from "@/core/messaging/service";
import type { Actor } from "@/core/service";
import { getT } from "../../i18n";
import { domainOrNull } from "../read-helpers";

const CHANNEL_TONES: Record<string, Tone> = {
  form: "neutral",
  email: "accent",
  sms: "success",
  mms: "success",
  chat: "accent",
  assistant: "warning",
  social: "neutral",
};

export async function ConversationsPanel({
  actor,
  contactId,
  locale,
  timezone,
}: {
  actor: Actor;
  contactId: string;
  locale: string;
  timezone: string;
}) {
  const [t, threads] = await Promise.all([
    getT(),
    domainOrNull(listConversations.call({ contactId, limit: 10 }, actor)),
  ]);

  // The messages of each thread, so the panel reads as a conversation rather
  // than a list of subject lines.
  const withMessages = await Promise.all(
    (threads ?? []).map((thread) =>
      domainOrNull(getConversation.call({ id: thread.id, limit: 50 }, actor)),
    ),
  );

  return (
    <Card>
      <CardHeader title={t("conversations.title")} />
      <CardBody>
        {threads === null ? (
          <p className="text-sm text-danger">{t("conversations.unavailable")}</p>
        ) : threads.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">{t("conversations.empty")}</p>
        ) : (
          <ul className="grid list-none gap-3 p-0">
            {withMessages.filter(Boolean).map((thread) => (
              <li key={thread!.id} className="grid gap-2 rounded-md border border-rule p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {thread!.subject ?? t("conversations.noSubject")}
                  </span>
                  <Pill tone={thread!.status === "open" ? "accent" : "neutral"}>
                    {t(`conversations.status.${thread!.status}`)}
                  </Pill>
                  {thread!.unread ? <Pill tone="warning">{t("conversations.unread")}</Pill> : null}
                  <span className="ms-auto text-xs text-ink-muted">
                    {t("conversations.replyBy", {
                      channel: t(`conversations.channel.${thread!.replyChannel}`),
                    })}
                  </span>
                </div>
                <ol className="grid list-none gap-1 p-0">
                  {thread!.messages.map((message) => (
                    <li
                      key={message.id}
                      className="grid gap-1 border-b border-rule py-1.5 text-sm last:border-b-0"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                        {/* Which door it came through: a mixed thread is only
                            readable if every line says. */}
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
                        {/* What the carrier said, not what we hoped. */}
                        {message.deliveries.length > 0 ? (
                          <span>
                            {t(
                              `conversations.delivery.${message.deliveries[message.deliveries.length - 1]!.status}`,
                            )}
                          </span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap">{message.body}</p>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
