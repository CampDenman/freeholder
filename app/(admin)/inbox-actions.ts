// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the inbox (C7.09). The reply-channel rule, the refusal to
// snooze into the past, and the fact that bulk is the same services in a loop
// all live in `core/messaging/inbox`.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  assignConversation,
  bulkConversations,
  replyToConversation,
  setConversationStatus,
  snoozeConversation,
} from "@/core/messaging/inbox";
import { markConversationRead } from "@/core/messaging/service";
import { ownerFacing } from "./action-helpers";

const INBOX = "/admin/inbox";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/** Back to the thread, or to the list if this came from there. */
function backTo(form: FormData): string {
  const id = text(form, "id");
  return text(form, "from") === "list" || !id ? INBOX : `${INBOX}/${id}`;
}

export async function assignConversationAction(form: FormData): Promise<void> {
  const path = backTo(form);
  try {
    await assignConversation.call(
      { id: text(form, "id"), userId: text(form, "userId") || null },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That could not be handed over.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=assigned`);
}

export async function snoozeConversationAction(form: FormData): Promise<void> {
  const path = backTo(form);
  try {
    const until = text(form, "until");
    if (!until) throw new ServiceError("validation", "Say when it should come back.");
    // A date input has no time; nine in the morning is when somebody means
    // "tomorrow", not one minute past midnight.
    await snoozeConversation.call(
      { id: text(form, "id"), until: `${until}T09:00:00.000Z` },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That could not be put away.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=snoozed`);
}

export async function setConversationStatusAction(form: FormData): Promise<void> {
  const path = backTo(form);
  const status = text(form, "status") === "closed" ? "closed" : "open";
  try {
    await setConversationStatus.call({ id: text(form, "id"), status }, await actor());
  } catch (error) {
    refused(error, path, "That could not be changed.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=${status}`);
}

export async function markConversationReadAction(form: FormData): Promise<void> {
  const path = backTo(form);
  try {
    await markConversationRead.call(
      { id: text(form, "id"), read: text(form, "read") !== "false" },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That could not be changed.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=read`);
}

export async function replyAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const path = `${INBOX}/${id}`;
  try {
    await replyToConversation.call(
      { id, body: text(form, "body"), close: text(form, "close") === "on" },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That reply could not be sent.");
  }
  revalidatePath(path);
  revalidatePath(INBOX);
  redirect(`${path}?saved=replied`);
}

export async function bulkConversationsAction(form: FormData): Promise<void> {
  try {
    const ids = form
      .getAll("selected")
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (ids.length === 0) {
      throw new ServiceError("validation", "Choose some conversations first.");
    }
    const action = text(form, "action");
    if (!["assign", "close", "reopen", "markRead", "markUnread", "snooze"].includes(action)) {
      throw new ServiceError("validation", "That is not something you can do to them.");
    }
    const until = text(form, "until");
    await bulkConversations.call(
      {
        ids,
        action: action as "assign" | "close" | "reopen" | "markRead" | "markUnread" | "snooze",
        userId: text(form, "userId") || null,
        ...(until ? { until: `${until}T09:00:00.000Z` } : {}),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, INBOX, "Those could not be changed.");
  }
  revalidatePath(INBOX);
  redirect(`${INBOX}?saved=bulk`);
}
