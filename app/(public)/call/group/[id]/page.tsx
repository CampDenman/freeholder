// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.24: a group call.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { viewGroupCall } from "@/modules/members/group-calls";
import { Callout } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { GroupCallRoom } from "../GroupCallRoom";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.groupCall.title"), robots: { index: false, follow: false } };
}

export default async function GroupCallPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, t, jar] = await Promise.all([params, getT(), cookies()]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") notFound();
  let call;
  try {
    call = await viewGroupCall.call({ id }, actor);
  } catch (error) {
    if (error instanceof ServiceError && (error.code === "not_found" || error.code === "permission")) notFound();
    throw error;
  }
  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-6 py-12">
      <a className="underline" href={`/messages/${call.conversationId}`}>{t("members.groupCall.back")}</a>
      <h1 className="text-2xl font-semibold">{call.title || t("members.groupCall.title")}</h1>
      <p className="text-sm text-ink-muted">{t("members.groupCall.privacy")}</p>
      {call.state === "ended" ? (
        <Callout>{t("members.groupCall.ended")}</Callout>
      ) : (
        <GroupCallRoom
          callId={call.id}
          conversationId={call.conversationId}
          userId={actor.userId}
          media={call.media}
          labels={{
            connecting: t("members.groupCall.connecting"),
            waitingKey: t("members.groupCall.waitingKey"),
            encrypted: t("members.groupCall.encrypted"),
            notEncrypted: t("members.groupCall.notEncrypted"),
            failed: t("members.groupCall.failed"),
            mute: t("members.groupCall.mute"),
            unmute: t("members.groupCall.unmute"),
            cameraOff: t("members.groupCall.cameraOff"),
            cameraOn: t("members.groupCall.cameraOn"),
            leave: t("members.groupCall.leave"),
            you: t("members.groupCall.you"),
            alone: t("members.groupCall.alone"),
            removed: t("members.groupCall.removed"),
          }}
        />
      )}
    </div>
  );
}
