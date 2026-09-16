// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Sending a campaign, from the admin. Thin, like every other caller (§11):
// each of these translates a form into one service call and nothing else.
//
// Note what is *not* here: no loop that sends the list. Pressing send starts a
// broadcast, and `newsletters.tickBroadcasts` carries it forward one committed
// batch at a time. A request that tried to send ten thousand messages would
// time out somewhere in the middle, and the owner would have no way to know
// where.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { zonedInstant } from "@/core/i18n/zoned";
import { currentBusiness } from "@/core/settings/read";
import {
  pauseBroadcast,
  resumeBroadcast,
  saveBroadcast,
  startBroadcast,
  testSend,
} from "@/modules/newsletters/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value.length > 0 ? value : null;
}

/**
 * Back where the owner was, saying what happened.
 *
 * A refused send is not a crash — a template missing a variable, an audience
 * with nobody in it, a sender that is not verified yet — and an owner needs to
 * read the reason on the page they pressed the button on.
 */
function done(id: string | null, error?: unknown, flag = "saved"): never {
  const base = id ? `/admin/newsletters/broadcasts/${id}` : "/admin/newsletters/broadcasts";
  if (error instanceof ServiceError) {
    redirect(`${base}?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("broadcast action failed");
  redirect(`${base}?${flag}=1`);
}

/**
 * A `datetime-local` value, read in the business's own timezone.
 *
 * The browser sends "2026-09-14T09:00" with no zone at all. Handing that
 * straight to `new Date` reads it as the *server's* local time, which on a
 * deployment running in UTC turns a nine o'clock send into one that goes out
 * in the middle of the night for a studio in Vancouver. §4.9 has one answer
 * for what "nine o'clock" means here, and it is the business timezone.
 */
function scheduledAt(value: string | null, timezone: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return zonedInstant(timezone, {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  });
}

export async function saveBroadcastAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = optional(form, "id");
  let saved: { id: string } | null = null;
  try {
    saved = await saveBroadcast.call(
      {
        ...(id ? { id } : {}),
        name: text(form, "name"),
        templateId: text(form, "templateId"),
        segmentId: text(form, "segmentId"),
        subject: optional(form, "subject"),
        scheduledAt: scheduledAt(
          optional(form, "scheduledAt"),
          (await currentBusiness())?.timezone ?? "UTC",
        ),
      },
      caller,
    );
  } catch (error) {
    done(id, error);
  }
  done(saved.id);
}

export async function startBroadcastAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await startBroadcast.call({ id }, caller);
  } catch (error) {
    done(id, error);
  }
  done(id, undefined, "started");
}

export async function pauseBroadcastAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await pauseBroadcast.call({ id, cancel: text(form, "cancel") === "1" }, caller);
  } catch (error) {
    done(id, error);
  }
  done(id, undefined, "paused");
}

export async function resumeBroadcastAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await resumeBroadcast.call({ id }, caller);
  } catch (error) {
    done(id, error);
  }
  done(id, undefined, "resumed");
}

/** One copy, to one address, before committing to the list. */
export async function testSendAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await testSend.call(
      {
        templateId: text(form, "templateId"),
        to: text(form, "to"),
        subject: optional(form, "subject"),
      },
      caller,
    );
  } catch (error) {
    done(id, error);
  }
  done(id, undefined, "tested");
}
