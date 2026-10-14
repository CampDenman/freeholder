// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.06: starting, answering and sending member messages.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  answerMessageRequest,
  leaveConversation,
  muteConversation,
  sendMessage,
  startConversation,
  unsendMessage,
} from "@/modules/members/messages";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function conversationPath(id: string): string {
  return /^[0-9a-f-]{36}$/.test(id) ? `/messages/${id}` : "/messages";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function startConversationAction(form: FormData): Promise<void> {
  let id: string;
  try {
    ({ id } = await startConversation.call(
      {
        handles: text(form, "to").split(/[\s,]+/).map((h) => h.replace(/^@/, "")).filter(Boolean),
        title: text(form, "title") || undefined,
        body: text(form, "body"),
      },
      await actor(),
    ));
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/messages?error=${error.code}`);
    throw error;
  }
  redirect(conversationPath(id));
}

export async function conversationAction(form: FormData): Promise<void> {
  const id = text(form, "conversationId");
  const verb = text(form, "verb");
  const who = await actor();
  let to = conversationPath(id);
  try {
    switch (verb) {
      case "send": await sendMessage.call({ conversationId: id, body: text(form, "body") }, who); break;
      case "accept": await answerMessageRequest.call({ conversationId: id, accept: true }, who); break;
      case "decline": await answerMessageRequest.call({ conversationId: id, accept: false }, who); to = "/messages"; break;
      case "leave": await leaveConversation.call({ conversationId: id }, who); to = "/messages"; break;
      case "mute": await muteConversation.call({ conversationId: id, muted: true }, who); break;
      case "unmute": await muteConversation.call({ conversationId: id, muted: false }, who); break;
      case "unsend": await unsendMessage.call({ id: text(form, "messageId") }, who); break;
      default: throw new ServiceError("validation", "Unknown action.");
    }
  } catch (error) {
    if (error instanceof ServiceError) redirect(`${conversationPath(id)}?error=${error.code}`);
    throw error;
  }
  redirect(to);
}
