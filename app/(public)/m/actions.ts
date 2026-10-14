// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.02/C12.03: follow, friend, block, mute and restrict from a profile or
// the portal's connections page.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  answerFollowRequest,
  befriendMember,
  followMember,
  setMemberRelation,
  unfollowMember,
  unfriendMember,
} from "@/modules/members/graph";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Only ever return to a profile or the portal, never to a supplied URL. */
function back(form: FormData, handle: string): string {
  return text(form, "back") === "connections" ? "/portal/connections" : `/@${encodeURIComponent(handle)}`;
}

export async function memberGraphAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const handle = text(form, "handle").toLowerCase();
  const verb = text(form, "verb");
  const to = back(form, handle);
  try {
    switch (verb) {
      case "follow": await followMember.call({ handle }, actor); break;
      case "unfollow": await unfollowMember.call({ handle }, actor); break;
      case "approve": await answerFollowRequest.call({ handle, approve: true }, actor); break;
      case "decline": await answerFollowRequest.call({ handle, approve: false }, actor); break;
      case "befriend": await befriendMember.call({ handle }, actor); break;
      case "unfriend": await unfriendMember.call({ handle }, actor); break;
      case "block": case "mute": case "restrict":
        await setMemberRelation.call({ handle, kind: verb, on: true }, actor); break;
      case "unblock": case "unmute": case "unrestrict":
        await setMemberRelation.call({ handle, kind: verb.slice(2) as "block" | "mute" | "restrict", on: false }, actor); break;
      default: throw new ServiceError("validation", "Unknown action.");
    }
  } catch (error) {
    if (error instanceof ServiceError) redirect(`${to}?error=${error.code}`);
    throw error;
  }
  redirect(`${to}?done=${verb}`);
}
