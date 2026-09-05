// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The admin's popups. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  removePopup,
  savePopup,
  savePopupBlocks,
  setPopupStatus,
} from "@/modules/popups/service";
import { popupAdminReturnTo } from "@/modules/popups/http";
// Written out rather than imported from the schema: §15.5 keeps a route
// handler off the database, and the file already spells its other unions this
// way. The service validates the value regardless, so a typo here is refused
// rather than stored.
type Status = "draft" | "active" | "paused";

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

function digits(form: FormData, name: string, fallback: number): number {
  const parsed = Number.parseInt(text(form, name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maybeDigits(form: FormData, name: string): number | null {
  const raw = text(form, name);
  if (raw.length === 0) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** One value per line, which is how an owner actually types a list of paths. */
function lines(form: FormData, name: string): string[] {
  return text(form, name)
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 20);
}

function done(to: string, error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`${to}?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("popup action failed");
  redirect(`${to}?saved=1`);
}

export async function savePopupAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = optional(form, "id");
  const back = id ? `/admin/popups/${id}` : "/admin/popups";
  let saved: { id: string } | null = null;
  try {
    saved = await savePopup.call(
      {
        ...(id ? { id } : {}),
        slug: text(form, "slug"),
        name: text(form, "name"),
        title: text(form, "title"),
        surface: (text(form, "surface") || "modal") as "modal" | "banner" | "corner",
        trigger: (text(form, "trigger") || "delay") as
          | "immediate"
          | "delay"
          | "scroll"
          | "exitIntent",
        triggerValue: digits(form, "triggerValue", 5),
        audience: (text(form, "audience") || "everyone") as
          | "everyone"
          | "inSegment"
          | "notInSegment",
        segmentId: optional(form, "segmentId"),
        pathPatterns: lines(form, "pathPatterns"),
        locales: lines(form, "locales"),
        frequencyCap: maybeDigits(form, "frequencyCap"),
        frequencyPeriodHours: digits(form, "frequencyPeriodHours", 168),
        dismissSuppressHours: digits(form, "dismissSuppressHours", 720),
        stopAfterCapture: form.get("stopAfterCapture") === "1",
        captureMode: (text(form, "captureMode") || "none") as "none" | "email",
        newsletterId: optional(form, "newsletterId"),
        consentStatement: optional(form, "consentStatement"),
        consentVersion: optional(form, "consentVersion"),
        successMessage: optional(form, "successMessage"),
        startsAt: optional(form, "startsAt")
          ? new Date(`${text(form, "startsAt")}T00:00:00`)
          : null,
        endsAt: optional(form, "endsAt")
          ? new Date(`${text(form, "endsAt")}T23:59:59`)
          : null,
        priority: digits(form, "priority", 0),
      },
      caller,
    );
  } catch (error) {
    done(back, error);
  }
  revalidatePath("/admin/popups");
  // A newly created popup has no body yet, so the useful next screen is the
  // one where you write it rather than the list you just came from.
  done(`/admin/popups/${saved.id}`);
}

export interface PopupSaveResult {
  error?: string;
}

/** Autosave from the block editor: it has nowhere to throw, so it gets a value. */
export async function savePopupBlocksAction(
  id: string,
  blocks: unknown,
): Promise<PopupSaveResult> {
  try {
    await savePopupBlocks.call({ id, blocks }, await actor());
    revalidatePath(`/admin/popups/${id}`);
    return {};
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("popup blocks save failed", error);
    return { error: "Something went wrong. Try again." };
  }
}

export async function setPopupStatusAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  const back = popupAdminReturnTo(text(form, "returnTo"));
  try {
    await setPopupStatus.call(
      { id, status: (text(form, "status") || "draft") as Status },
      caller,
    );
  } catch (error) {
    done(back, error);
  }
  revalidatePath("/admin/popups");
  done(back);
}

export async function deletePopupAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await removePopup.call(
      { id: text(form, "id"), confirm: form.get("confirm") === "1" },
      caller,
    );
  } catch (error) {
    done("/admin/popups", error);
  }
  revalidatePath("/admin/popups");
  done("/admin/popups");
}
