// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.12: send a report to the site's moderators.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { reportContent } from "@/modules/members/reports";
import { REPORT_REASONS, REPORT_TARGETS } from "@/modules/members/report-kinds";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Untrimmed: a franked body must match byte for byte. */
function exact(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

export async function reportAction(form: FormData): Promise<void> {
  const type = text(form, "type");
  const id = text(form, "id");
  const reason = text(form, "reason");
  const conversation = text(form, "in");
  const here = `/report?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}${/^[0-9a-f-]{36}$/.test(conversation) ? `&in=${conversation}` : ""}`;
  if (!(REPORT_TARGETS as readonly string[]).includes(type) || !(REPORT_REASONS as readonly string[]).includes(reason)) redirect(`${here}&error=validation`);
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    await reportContent.call(
      {
        targetType: type as (typeof REPORT_TARGETS)[number],
        targetId: id,
        reason: reason as (typeof REPORT_REASONS)[number],
        details: text(form, "details"),
        // C12.23: an encrypted message, as the reporter's device read it.
        franking: form.has("frankKey") ? { body: exact(form, "frankBody"), key: text(form, "frankKey") } : undefined,
      },
      actor,
    );
  } catch (error) {
    if (error instanceof ServiceError) redirect(`${here}&error=${error.code}`);
    throw error;
  }
  redirect(`${here}&sent=1`);
}
