// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.06: one conversation.
import type { Metadata } from "next";
import { Attachments, MediaAttach } from "../../m/MediaAttach";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime } from "@/core/i18n";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { viewConversation } from "@/modules/members/messages";
import { activeGroupCall } from "@/modules/members/group-calls";
import { GroupCallButtons } from "../../call/group/GroupCallRoom";
import { Button, Callout, Pill } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { conversationAction } from "../actions";
import { DeviceVerification, SecureBody, SecureComposer, SecureConversation, SecureStatus } from "../SecureConversation";

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
  if (actor.kind !== "user") notFound();
  const groupCall = c.kind === "group" && c.e2ee && c.state === "active" ? await activeGroupCall.call({ conversationId: c.id }, actor) : null;
  const people: Record<string, string> = Object.fromEntries<string>([...c.people.map((p): [string, string] => [p.userId, p.displayName]), [actor.userId, t("members.e2ee.you")]]);
  const secureLabels = { loading: t("members.e2ee.decrypting"), unreadable: t("members.e2ee.unreadable"), before: t("members.e2ee.before") };
  return (
    <SecureConversation conversationId={c.id} userId={actor.userId}>
    <div className="mx-auto grid max-w-2xl gap-6 px-6 py-12">
      <a className="underline" href="/messages">{t("members.messages.back")}</a>
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-sm text-ink-muted">
        {c.people.map((p, i) => <span key={p.handle}>{i ? ", " : ""}<a className="underline" href={`/@${p.handle}`}>@{p.handle}</a></span>)}
      </p>
      <SecureStatus labels={{ encrypted: t("members.e2ee.on"), joining: t("members.e2ee.joining"), plaintext: t("members.e2ee.waiting"), failed: t("members.e2ee.failed") }} />
      <DeviceVerification
        conversationId={c.id}
        userId={actor.userId}
        people={people}
        labels={{
          title: t("members.e2ee.verifyTitle"),
          intro: t("members.e2ee.verifyIntro"),
          number: t("members.e2ee.safetyNumber"),
          unknown: t("members.e2ee.unknownAccount"),
          thisDevice: t("members.e2ee.thisDevice"),
          changed: t("members.e2ee.devicesChanged"),
          added: t("members.e2ee.devicesAdded"),
          removed: t("members.e2ee.devicesRemoved"),
          confirm: t("members.e2ee.devicesConfirm"),
        }}
      />
      {query.error ? <Callout tone="danger">{t("members.messages.failed")}</Callout> : null}
      {groupCall?.available ? (
        <GroupCallButtons
          conversationId={c.id}
          userId={actor.userId}
          active={groupCall.call}
          labels={{ voice: t("members.groupCall.startVoice"), video: t("members.groupCall.startVideo"), join: t("members.groupCall.join"), failed: t("members.groupCall.failed") }}
        />
      ) : null}
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
            {m.encrypted ? (
              <SecureBody id={m.id} labels={secureLabels} />
            ) : m.body === null ? (
              <p className="italic text-ink-muted">{t("members.messages.removed")}</p>
            ) : (
              <>
                <p className="whitespace-pre-line break-words">{m.body}</p>
                {c.e2ee ? <p><Pill>{t("members.e2ee.notEncrypted")}</Pill></p> : null}
              </>
            )}
            <Attachments items={m.attachments} />
            {m.mine && (m.body !== null || m.encrypted) ? (
              <form action={conversationAction}>
                <input type="hidden" name="conversationId" value={c.id} />
                <input type="hidden" name="verb" value="unsend" />
                <input type="hidden" name="messageId" value={m.id} />
                <Button type="submit" variant="quiet">{t("members.messages.unsend")}</Button>
              </form>
            ) : null}
            {!m.mine && (m.body !== null || m.encrypted) && m.sender ? <p><a className="text-sm text-ink-muted underline" href={`/report?type=message&id=${m.id}&in=${c.id}`}>{t("members.report.action")}</a></p> : null}
          </li>
        ))}
      </ol>
      {view.seenBy.length ? <p className="text-sm text-ink-muted">{t("members.messages.seenBy", { names: view.seenBy.map((p) => p.displayName).join(", ") })}</p> : null}
      {c.state === "active" && !view.closed ? (
        <SecureComposer conversationId={c.id} fallback={conversationAction} labels={{ body: t("members.messages.body"), send: t("members.messages.send"), sending: t("members.e2ee.sending"), failed: t("members.messages.failed") }}>
          <MediaAttach id="message" labels={{ add: t("members.attach.add"), describe: t("members.attach.describe"), uploading: t("members.avatar.uploading"), failed: t("members.avatar.failed"), remove: t("members.attach.remove") }} />
          {c.e2ee ? <p className="text-sm text-ink-muted">{t("members.e2ee.attachmentsNote")}</p> : null}
        </SecureComposer>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Verb id={c.id} verb={c.muted ? "unmute" : "mute"} label={t(c.muted ? "members.messages.unmute" : "members.messages.mute")} variant="quiet" />
        <Verb id={c.id} verb="leave" label={t("members.messages.leave")} variant="danger" />
      </div>
    </div>
    </SecureConversation>
  );
}
