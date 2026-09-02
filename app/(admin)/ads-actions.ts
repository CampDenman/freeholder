// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The admin's ad inventory. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  decideCampaign,
  invoiceCampaign,
  reconcileCampaign,
  reviewCreative,
  saveAdvertiser,
  saveCampaign,
  saveCreative,
  saveLineItem,
  saveSlot,
  setCampaignStatus,
} from "@/modules/ads/service";

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

function done(error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`/admin/ads?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("ads action failed");
  redirect("/admin/ads?saved=1");
}

/**
 * The sizes an owner ticked, as the per-breakpoint shape the slot stores.
 *
 * §4.16: "A slot declares a *set* per breakpoint, so one placement serves a
 * leaderboard on a laptop and a 320x50 on a phone without the owner building
 * two pages." The form posts `size` checkboxes carrying `breakpoint:WxH`, and
 * this groups them — which is the whole reason the field is not one dropdown.
 */
function formatsFrom(form: FormData): Array<{ breakpoint: string; sizes: unknown[] }> {
  const grouped = new Map<string, Array<{ width: number; height: number }>>();
  for (const raw of form.getAll("size")) {
    if (typeof raw !== "string") continue;
    const [breakpoint, shape] = raw.split(":");
    const parts = (shape ?? "").split("x").map((n) => Number.parseInt(n, 10));
    const width = parts[0];
    const height = parts[1];
    if (!breakpoint || width === undefined || height === undefined) continue;
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    grouped.set(breakpoint, [...(grouped.get(breakpoint) ?? []), { width, height }]);
  }
  return [...grouped.entries()].map(([breakpoint, sizes]) => ({ breakpoint, sizes }));
}

export async function saveSlotAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await saveSlot.call(
      {
        ...(optional(form, "id") ? { id: text(form, "id") } : {}),
        name: text(form, "name"),
        code: text(form, "code"),
        description: optional(form, "description"),
        formats: formatsFrom(form) as never,
        lazy: form.get("lazy") === "1",
        refreshSeconds: digits(form, "refreshSeconds", 0),
        allowHouseFill: form.get("allowHouseFill") === "1",
        allowThirdParty: form.get("allowThirdParty") === "1",
        status: (text(form, "status") || "draft") as "draft" | "active" | "retired",
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

/**
 * An advertiser is a Contact (§4.16), so this takes an email and resolves one.
 *
 * The form offers an existing contact *or* an email, because both are real:
 * the local bakery already in the CRM, and the media buyer who has never
 * bought anything else. `saveAdvertiser` calls `contacts.resolve`, so either
 * way there is exactly one record for that person.
 */
export async function saveAdvertiserAction(form: FormData): Promise<void> {
  const caller = await actor();
  const contactId = optional(form, "contactId");
  const email = optional(form, "email");
  try {
    await saveAdvertiser.call(
      {
        ...(contactId ? { contactId } : {}),
        ...(email ? { email } : {}),
        ...(optional(form, "name") ? { name: text(form, "name") } : {}),
        displayName: optional(form, "displayName"),
        website: optional(form, "website"),
        notes: optional(form, "notes"),
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

export async function saveCampaignAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await saveCampaign.call(
      {
        ...(optional(form, "id") ? { id: text(form, "id") } : {}),
        advertiserContactId: text(form, "advertiserContactId"),
        name: text(form, "name"),
        startsAt: optional(form, "startsAt")
          ? new Date(`${text(form, "startsAt")}T00:00:00`)
          : null,
        endsAt: optional(form, "endsAt") ? new Date(`${text(form, "endsAt")}T23:59:59`) : null,
        pricing: (text(form, "pricing") || "house") as "cpm" | "cpc" | "flat" | "house",
        rateCents: digits(form, "rateCents", 0),
        budgetCents: maybeDigits(form, "budgetCents"),
        pacing: (text(form, "pacing") || "even") as "even" | "asap",
        priority: digits(form, "priority", 0),
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

export async function saveLineItemAction(form: FormData): Promise<void> {
  const caller = await actor();
  const slotIds = form
    .getAll("slotIds")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  try {
    await saveLineItem.call(
      {
        ...(optional(form, "id") ? { id: text(form, "id") } : {}),
        campaignId: text(form, "campaignId"),
        name: text(form, "name"),
        slotIds,
        goalImpressions: maybeDigits(form, "goalImpressions"),
        goalClicks: maybeDigits(form, "goalClicks"),
        weight: digits(form, "weight", 1),
        status: (text(form, "status") || "draft") as "draft" | "active" | "paused",
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

export async function decideCampaignAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await decideCampaign.call(
      {
        id: text(form, "id"),
        decision: text(form, "decision") as "approved" | "rejected",
        note: optional(form, "note"),
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

export async function setCampaignStatusAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await setCampaignStatus.call(
      {
        id: text(form, "id"),
        status: text(form, "status") as
          | "draft"
          | "scheduled"
          | "live"
          | "paused"
          | "completed",
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

/**
 * The artwork. §4.16's in-house case first: an uploaded asset from the media
 * library, a headline and a click URL.
 *
 * The size is posted as one "WxH" value from a list of what the line item's
 * positions actually declare, rather than as two free numbers, because a
 * creative in a size no slot accepts can never run — and the owner's only
 * symptom would be an advertiser asking why they saw no impressions.
 */
export async function saveCreativeAction(form: FormData): Promise<void> {
  const caller = await actor();
  const [width, height] = text(form, "size")
    .split("x")
    .map((value) => Number.parseInt(value, 10));
  try {
    await saveCreative.call(
      {
        ...(optional(form, "id") ? { id: text(form, "id") } : {}),
        lineItemId: text(form, "lineItemId"),
        kind: (text(form, "kind") || "image") as "image" | "native",
        assetId: optional(form, "assetId"),
        width: Number.isFinite(width) ? width! : 0,
        height: Number.isFinite(height) ? height! : 0,
        clickUrl: text(form, "clickUrl"),
        altText: optional(form, "altText"),
        headline: optional(form, "headline"),
        body: optional(form, "body"),
        ctaLabel: optional(form, "ctaLabel"),
        status: (text(form, "status") || "draft") as "draft" | "active" | "paused",
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

export async function reviewCreativeAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await reviewCreative.call(
      {
        id: text(form, "id"),
        decision: text(form, "decision") as "approved" | "rejected",
        note: optional(form, "note"),
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

/**
 * Selling an ad is selling a product (§4.16), so this raises an ordinary
 * draft invoice and leaves issuing it to the invoice screen, where the tax
 * question is asked properly.
 */
export async function invoiceCampaignAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await invoiceCampaign.call({ id: text(form, "id") }, caller);
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}

export async function reconcileCampaignAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await reconcileCampaign.call({ id: text(form, "id") }, caller);
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/ads");
  done();
}
