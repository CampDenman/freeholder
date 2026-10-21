// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.24: starting, joining and leaving group calls.
"use server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { joinGroupCall, leaveGroupCall, startGroupCall } from "@/modules/members/group-calls";

type Result<T> = { ok: T } | { error: { code: string; message: string } };

async function run<T>(work: (actor: Awaited<ReturnType<typeof actorFromToken>>) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: await work(await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value)) };
  } catch (error) {
    if (error instanceof ServiceError) return { error: { code: error.code, message: error.message } };
    throw error;
  }
}

export async function startGroupCallAction(input: { conversationId: string; media: "voice" | "video" }) {
  return run((actor) => startGroupCall.call(input, actor));
}
export async function joinGroupCallAction(input: { id: string; deviceId: string }) {
  return run((actor) => joinGroupCall.call(input, actor));
}
export async function leaveGroupCallAction(input: { id: string }) {
  return run((actor) => leaveGroupCall.call(input, actor));
}
