// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.07: the browser's side of a call. Each action is the signed-in member
// calling the shared service layer; nothing here decides permissions.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  answerCall,
  callSettings,
  callStatus,
  endCall,
  incomingCalls,
  sendSignal,
  startCall,
  takeSignals,
} from "@/modules/members/calls";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function startCallAction(form: FormData): Promise<void> {
  const raw = form.get("handle");
  const handle = (typeof raw === "string" ? raw : "").toLowerCase();
  const media = form.get("media") === "video" ? "video" : "voice";
  let id: string;
  try {
    ({ id } = await startCall.call({ handle, media }, await actor()));
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/@${encodeURIComponent(handle)}?error=${error.code}`);
    throw error;
  }
  redirect(`/call/${id}`);
}

export async function ringingCalls() {
  const who = await actor();
  if (who.kind !== "user") return [];
  return incomingCalls.call({}, who).catch(() => []);
}

export async function callConfig() {
  return callSettings.call({}, await actor());
}

export async function callState(id: string) {
  return callStatus.call({ id }, await actor());
}

export async function answer(id: string, accept: boolean) {
  return answerCall.call({ id, accept }, await actor());
}

export async function hangUp(id: string) {
  await endCall.call({ id }, await actor());
}

export async function signal(callId: string, kind: "offer" | "answer" | "candidate", payload: unknown) {
  try {
    await sendSignal.call({ callId, kind, payload }, await actor());
  } catch (error) {
    // Network candidates keep arriving for a moment after a hang-up.
    if (error instanceof ServiceError && error.code === "conflict") return;
    throw error;
  }
}

export async function collect(callId: string) {
  return takeSignals.call({ callId }, await actor());
}
