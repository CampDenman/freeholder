// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.06: one conversation.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime } from "@/core/i18n";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { viewConversation } from "@/modules/members/messages";
import { Button, Callout, Field } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { conversationAction } from "../actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.messages.title"), robots: { index: false, follow: false } };
}

function Verb({ id, verb, label, variant }: { id: string; verb: string; label: string; variant?: "quiet" | "danger" }) {
  return (
    <form action={conversationAction}>
      <input type="hidden" name="conversationId" value={id} />
      <input type="hidden" name="verb" value={verb} />
      <Button type="submit" variant={variant}>{label}</Button>
    </form>
  );
}

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, query, t, locale, business, jar] = await Promise.all([params, searchParams, getT(), getLocale(), currentBusiness(), cookies()]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  let view;
  try {
    view = await viewConversation.call({ id }, actor);
  } catch (error) {
    if (error instanceof ServiceError && (error.code === "not_found" || error.code === "permission")) notFound();
    throw error;
  }
  const c = view.conversation;
  const timezone = business?.timezone ?? "UTC";
  const name = c.title ?? c.people.map((p) => p.displayName).join(", ");
  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <a className="underline" href="/messages">{t("members.messages.back")}</a>
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-sm text-ink-muted">
        {c.people.map((p, i) => <span key={p.handle}>{i ? ", " : ""}<a className="underline" href={`/@${p.handle}`}>@{p.handle}</a></span>)}
      </p>
      {query.error ? <Callout tone="danger">{t("members.messages.failed")}</Callout> : null}
      {view.closed ? <Callout>{t("members.messages.closed")}</Callout> : null}
      {c.state === "requested" ? (
        <Callout>
          <span className="grid gap-3">
            <span>{t("members.messages.requestExplain")}</span>
            <span className="flex gap-2">
              <Verb id={c.id} verb="accept" label={t("members.messages.accept")} />
              <Verb id={c.id} verb="decline" label={t("members.messages.decline")} variant="quiet" />
            </span>
          </span>
        </Callout>
      ) : null}
      <ol className="grid gap-3" aria-label={t("members.messages.thread")}>
        {view.messages.map((m) => (
          <li key={m.id} className={`grid gap-1 rounded-lg border border-rule p-3 ${m.mine ? "ms-8 bg-surface-muted" : "me-8 bg-surface"}`}>
            <p className="text-xs text-ink-muted">
              {m.sender ? m.sender.displayName : t("members.messages.formerMember")} · {formatDateTime(m.createdAt, timezone, locale)}
            </p>
            {m.body === null ? <p className="italic text-ink-muted">{t("members.messages.removed")}</p> : <p className="whitespace-pre-line break-words">{m.body}</p>}
            {m.mine && m.body !== null ? (
              <form action={conversationAction}>
                <input type="hidden" name="conversationId" value={c.id} />
                <input type="hidden" name="verb" value="unsend" />
                <input type="hidden" name="messageId" value={m.id} />
                <Button type="submit" variant="quiet">{t("members.messages.unsend")}</Button>
              </form>
            ) : null}
            {!m.mine && m.body !== null && m.sender ? <p><a className="text-sm text-ink-muted underline" href={`/report?type=message&id=${m.id}`}>{t("members.report.action")}</a></p> : null}
          </li>
        ))}
      </ol>
      {view.seenBy.length ? <p className="text-sm text-ink-muted">{t("members.messages.seenBy", { names: view.seenBy.map((p) => p.displayName).join(", ") })}</p> : null}
      {c.state === "active" && !view.closed ? (
        <form action={conversationAction} className="grid gap-2">
          <input type="hidden" name="conversationId" value={c.id} />
          <input type="hidden" name="verb" value="send" />
          <Field label={t("members.messages.body")} htmlFor="reply-body">
            <textarea id="reply-body" name="body" required maxLength={10000} rows={3} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
          </Field>
          <Button type="submit">{t("members.messages.send")}</Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Verb id={c.id} verb={c.muted ? "unmute" : "mute"} label={t(c.muted ? "members.messages.unmute" : "members.messages.mute")} variant="quiet" />
        <Verb id={c.id} verb="leave" label={t("members.messages.leave")} variant="danger" />
      </div>
    </div>
  );
}
