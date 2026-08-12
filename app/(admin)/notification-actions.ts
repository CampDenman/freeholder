// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import {
  archiveNotification,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
  updateNotificationSettings,
  type NotificationChannel,
  type NotificationMode,
} from "@/core/notifications/service";
import { ServiceError } from "@/core/service";

export interface NotificationActionState {
  error?: string;
  saved?: boolean;
}

async function currentActor() {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return { ...actor, request: requestMetadataFromHeaders(await headers()) };
}

function present(error: unknown): NotificationActionState {
  if (error instanceof ServiceError) return { error: error.message };
  console.error("notification action failed", error);
  return { error: "Something went wrong. Try again." };
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/admin/notifications");
}

export async function notificationItemAction(
  _previous: NotificationActionState,
  form: FormData,
): Promise<NotificationActionState> {
  try {
    const actor = await currentActor();
    const id = field(form, "id");
    const intent = field(form, "intent");
    if (intent === "archive") await archiveNotification.call({ id }, actor);
    else if (intent === "read") await markNotificationRead.call({ id, read: true }, actor);
    else if (intent === "unread") await markNotificationRead.call({ id, read: false }, actor);
    else if (intent === "read-all") await markAllNotificationsRead.call({}, actor);
    else return { error: "Unknown notification action." };
  } catch (error) {
    return present(error);
  }
  refresh();
  return { saved: true };
}

export async function notificationPreferencesAction(
  _previous: NotificationActionState,
  form: FormData,
): Promise<NotificationActionState> {
  const preferences: Array<{
    topic: string;
    channel: NotificationChannel;
    mode: NotificationMode;
  }> = [];
  for (const [key, raw] of form.entries()) {
    if (!key.startsWith("preference:" ) || typeof raw !== "string") continue;
    const [, topic, channel] = key.split(":");
    if (!topic || !["in_app", "email", "sms", "push"].includes(channel ?? "")) continue;
    if (!["immediate", "digest", "off"].includes(raw)) continue;
    preferences.push({
      topic,
      channel: channel as NotificationChannel,
      mode: raw as NotificationMode,
    });
  }
  try {
    await updateNotificationPreferences.call({ preferences }, await currentActor());
  } catch (error) {
    return present(error);
  }
  refresh();
  return { saved: true };
}

export async function notificationSettingsAction(
  _previous: NotificationActionState,
  form: FormData,
): Promise<NotificationActionState> {
  const [hours, minutes] = field(form, "digestTime").split(":").map(Number);
  try {
    await updateNotificationSettings.call({
      digestCadence: field(form, "digestCadence"),
      digestMinute: (hours ?? 0) * 60 + (minutes ?? 0),
      digestWeekday: Number(field(form, "digestWeekday")),
      timezone: field(form, "timezone"),
      escalationMinutes: Number(field(form, "escalationMinutes")),
    }, await currentActor());
  } catch (error) {
    return present(error);
  }
  refresh();
  return { saved: true };
}
