// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.06 (MASTER.md §44.6): a member's conversations and message requests.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { listConversations, unreadConversations } from "@/modules/members/messages";
import { myMembership } from "@/modules/members/service";
import { Callout, Field, Input } from "@/ui/primitives";
import { getLocale, getT } from "../../i18n";
import { startConversationAction } from "./actions";
import { HistoryPanel, NewConversation } from "./SecureConversation";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.messages.title"), robots: { index: false, follow: false } };
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ box?: string; to?: string; error?: string }> }) {
  const [t, locale, business, jar, query] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies(), searchParams]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const me = actor.kind === "user" ? await myMembership.call({}, actor) : null;
  if (!me || me.status !== "active") {
    return (
      <div className="mx-auto grid max-w-2xl gap-4 px-6 py-12">
        <h1 className="text-3xl font-semibold">{t("members.messages.title")}</h1>
        <p>{t("members.profile.notMember")}</p>
        <a className="underline" href="/join">{t("members.join.title")}</a>
      </div>
    );
  }
  const box = query.box === "requests" ? "requests" : "inbox";
  const [conversations, counts] = await Promise.all([listConversations.call({ box }, actor), unreadConversations.call({}, actor)]);
  const timezone = business?.timezone ?? "UTC";
  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">{t("members.messages.title")}</h1>
      <p className="text-sm text-ink-muted">{t("members.messages.privacy")}</p>
      <nav aria-label={t("members.messages.boxes")} className="flex gap-4">
        <a className="underline" href="/messages" aria-current={box === "inbox" ? "page" : undefined}>{t("members.messages.inbox", { count: counts.unread })}</a>
        <a className="underline" href="/messages?box=requests" aria-current={box === "requests" ? "page" : undefined}>{t("members.messages.requests", { count: counts.requests })}</a>
      </nav>
      {query.error ? <Callout tone="danger">{t("members.messages.failed")}</Callout> : null}
      <HistoryPanel
        userId={me.userId}
        labels={{
          title: t("members.history.title"),
          intro: t("members.history.intro"),
          ask: t("members.history.ask"),
          asked: t("members.history.asked"),
          brought: t("members.history.brought", { n: "{n}" }),
          request: t("members.history.request", { device: "{device}" }),
          compare: t("members.history.compare"),
          send: t("members.history.send"),
          ignore: t("members.history.ignore"),
          sent: t("members.history.sent"),
          failed: t("members.history.failed"),
        }}
      />
      <NewConversation userId={me.userId} fallback={startConversationAction} labels={{ send: t("members.messages.send"), sending: t("members.e2ee.sending"), failed: t("members.messages.failed") }}>
        <Field label={t("members.messages.to")} htmlFor="message-to" hint={t("members.messages.toHint")}>
          <Input id="message-to" name="to" required defaultValue={query.to ?? ""} maxLength={2000} />
        </Field>
        <Field label={t("members.messages.groupTitle")} htmlFor="message-title">
          <Input id="message-title" name="title" maxLength={80} />
        </Field>
        <Field label={t("members.messages.body")} htmlFor="message-body">
          <textarea id="message-body" name="body" required maxLength={10000} rows={3} className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-sm" />
        </Field>
      </NewConversation>
      {box === "requests" ? <p className="text-sm text-ink-muted">{t("members.messages.requestsExplain")}</p> : null}
      {conversations.length === 0 ? <p className="text-ink-muted">{t("members.messages.empty")}</p> : null}
      <ul className="grid gap-2">
        {conversations.map((c) => (
          <li key={c.id}>
            <a className="grid gap-1 rounded-md border border-rule p-3 hover:bg-surface-muted" href={`/messages/${c.id}`}>
              <span className="font-semibold">{c.title ?? c.people.map((p) => p.displayName).join(", ")}</span>
              <span className="text-sm text-ink-muted">
                {formatDateTime(c.lastMessageAt, timezone, locale)}
                {c.unread ? ` · ${t("members.messages.unread")}` : ""}
                {c.muted ? ` · ${t("members.messages.muted")}` : ""}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
