// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.14: keys a member makes for their own agent.
"use server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { createMyKey, revokeMyKey } from "@/core/apikeys/personal";

const READ = ["members.feed", "members.latest", "members.postsBy", "members.viewPost", "members.profile", "members.connections", "members.conversations", "members.conversation", "notifications.list"];
/** What each choice lets an agent do, as the member. */
const KEY_PRESETS = {
  read: READ,
  post: [...READ, "members.post", "members.comment", "members.react"],
  message: [...READ, "members.startConversation", "members.sendMessage"],
} as const;

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function createKeyAction(input: { name: string; presets: string[]; days: number }): Promise<{ token?: string; error?: string }> {
  const scopes = [...new Set(input.presets.flatMap((p) => (p in KEY_PRESETS ? [...KEY_PRESETS[p as keyof typeof KEY_PRESETS]] : [])))];
  try {
    const created = await createMyKey.call({ name: input.name, scopes, expiresInDays: input.days }, await actor());
    return { token: created.token };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

export async function revokeKeyAction(id: string): Promise<{ error?: string }> {
  try {
    await revokeMyKey.call({ id }, await actor());
    return {};
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}
