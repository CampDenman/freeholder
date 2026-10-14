// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.13: a member's notifications and their per-type controls.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { markAllNotificationsRead, updateNotificationPreference } from "@/core/notifications/service";
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
  }
  redirect("/portal/notifications?saved=1");
}
