// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One of the customer's own threads, with a customer reply (C10.28, §4.14).
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Field, Pill } from "@/ui/primitives";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime } from "@/core/i18n";
import { getConversation } from "@/core/messaging/service";
import { myProfile } from "@/core/portal/service";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale, getT } from "../../../../i18n";
import { replyAsContactAction } from "../../../message-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PortalMessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const [locale, t, jar, business] = await Promise.all([
    getLocale(),
    getT(),
    cookies(),
    currentBusiness(),
  ]);
  const href = (path: string) =>
    business ? localizeCustomerHref(path, locale, business) : path;
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect(href("/portal/login"));

  const profile = await myProfile.call({}, actor).catch(() => null);
  if (!profile) redirect(href("/portal"));
  const thread = await getConversation.call(
    { id, contactId: profile.contactId, limit: 200 },
    actor,
  );
  if (!thread) notFound();
  const timezone = business?.timezone ?? "UTC";
  const title = thread.subject ?? t("conversations.noSubject");

  return (
    <section className="grid gap-4">
      <a href={href("/portal/messages")} className="text-sm text-ink-muted">
        {t("portal.messages.back")}
      </a>
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted">
        <Pill tone={thread.status === "open" ? "accent" : "neutral"}>
          {t(`conversations.status.${thread.status}`)}
        </Pill>
      </p>

      {query.sent ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("portal.messages.sent")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {t("portal.messages.failed")}
        </p>
      ) : null}

      <Card>
        <CardHeader title={t("portal.room.messages")} />
        <CardBody>
          {thread.messages.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("portal.messages.emptyThread")}</p>
          ) : (
            <ol className="grid list-none gap-3 p-0">
              {thread.messages.map((message) => (
                <li key={message.id} className="grid gap-1 border-b border-rule pb-3 last:border-b-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span>
                      {message.direction === "inbound"
                        ? t("portal.messages.you")
                        : t("portal.messages.business")}
                    </span>
                    <Pill tone="neutral">{t(`conversations.channel.${message.channel}`)}</Pill>
                    <time dateTime={message.occurredAt.toISOString()} className="tabular-nums">
                      {formatDateTime(message.occurredAt, timezone, locale)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ink">{message.body}</p>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <form action={replyAsContactAction} className="grid gap-3">
        <input type="hidden" name="id" value={thread.id} />
        <Field label={t("portal.messages.reply")} htmlFor="portal-message-body">
          <textarea
            id="portal-message-body"
            name="body"
            required
            rows={4}
            maxLength={50_000}
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm"
          />
        </Field>
        <div>
          <Button type="submit">{t("portal.messages.send")}</Button>
        </div>
      </form>
    </section>
  );
}
