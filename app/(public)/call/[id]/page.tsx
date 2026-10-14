// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.07 (MASTER.md §44.7): a private call between two members.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { callStatus } from "@/modules/members/calls";
import { getT } from "../../../i18n";
import { CallRoom } from "../CallRoom";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.calls.title"), robots: { index: false, follow: false } };
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, t, jar] = await Promise.all([params, getT(), cookies()]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  let call;
  try {
    call = await callStatus.call({ id }, actor);
  } catch (error) {
    if (error instanceof ServiceError) notFound();
    throw error;
  }
  const labels = Object.fromEntries(
    ["ringing", "connecting", "connected", "ended", "declined", "missed", "hangUp", "mute", "unmute", "cameraOff", "cameraOn", "you", "noDevice", "directOnly"].map((k) => [k, t(`members.calls.${k}`)]),
  );
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">
        {t(call.media === "video" ? "members.calls.videoWith" : "members.calls.voiceWith", { name: call.other.displayName })}
      </h1>
      <p className="text-sm text-ink-muted">{t("members.calls.privacy")}</p>
      <CallRoom
        id={call.id}
        role={call.role}
        media={call.media}
        initialState={call.state}
        labels={{ ...(labels as Record<string, string>), them: call.other.displayName } as Parameters<typeof CallRoom>[0]["labels"]}
      />
      <a className="underline" href={`/@${call.other.handle}`}>{t("members.calls.back", { name: call.other.displayName })}</a>
    </div>
  );
}
