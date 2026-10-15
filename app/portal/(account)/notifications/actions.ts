// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.13: a member's notifications and their per-type controls.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import {
  markAllNotificationsRead,
  notificationPreferenceStatus,
  subscribeWebPush,
  unsubscribeWebPush,
  updateNotificationPreference,
  updateNotificationSettings,
  webPushPublicKey,
} from "@/core/notifications/service";
import { ServiceError } from "@/core/service";
import { MEMBER_TOPICS } from "./topics";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function markAllReadAction(): Promise<void> {
  await markAllNotificationsRead.call({}, await actor());
  redirect("/portal/notifications");
}

export async function savePreferencesAction(form: FormData): Promise<void> {
  const who = await actor();
  for (const topic of MEMBER_TOPICS) {
    const inApp = form.get(`${topic}:in_app`) === "off" ? "off" : "immediate";
    const emailValue = form.get(`${topic}:email`);
    const email = emailValue === "immediate" || emailValue === "off" ? emailValue : "digest";
    await updateNotificationPreference.call({ topic, channel: "in_app", mode: inApp }, who);
    await updateNotificationPreference.call({ topic, channel: "email", mode: email }, who);
    const push = form.get(`${topic}:push`) === "off" ? "off" : "immediate";
    await updateNotificationPreference.call({ topic, channel: "push", mode: push }, who);
  }
  redirect("/portal/notifications?saved=1");
}

export async function pushKeyAction(): Promise<{ publicKey: string }> {
  return webPushPublicKey.call({}, await actor());
}

export async function subscribePushAction(input: { endpoint: string; p256dh: string; auth: string }): Promise<{ error?: string }> {
  try {
    await subscribeWebPush.call(input, await actor());
    return {};
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

export async function unsubscribePushAction(endpoint: string): Promise<void> {
  await unsubscribeWebPush.call({ endpoint }, await actor());
}

function minutes(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h! * 60 + m!;
}

export async function saveQuietHoursAction(form: FormData): Promise<void> {
  const who = await actor();
  const { settings } = await notificationPreferenceStatus.call({}, who);
  const start = form.get("quietOn") === "yes" ? minutes(form.get("quietStart")) : null;
  const end = start === null ? null : minutes(form.get("quietEnd"));
  const timezone = typeof form.get("timezone") === "string" && form.get("timezone") ? (form.get("timezone") as string) : settings.timezone ?? "UTC";
  try {
    await updateNotificationSettings.call({
      digestCadence: settings.digestCadence,
      digestMinute: settings.digestMinute,
      digestWeekday: settings.digestWeekday,
      escalationMinutes: settings.escalationMinutes,
      timezone,
      quietStartMinute: end === null ? null : start,
      quietEndMinute: end,
    }, who);
  } catch (error) {
    if (error instanceof ServiceError) redirect("/portal/notifications?error=quiet");
    throw error;
  }
  redirect("/portal/notifications?saved=1");
}

