// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { savePaywall } from "@/core/paywalls/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function digits(form: FormData, name: string, fallback: number): number {
  const value = Number(text(form, name));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function done(error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`/admin/paywalls?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("paywall action failed");
  redirect("/admin/paywalls?saved=1");
}

export async function savePaywallAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  const entitlements = text(form, "requiredEntitlementIds")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  try {
    await savePaywall.call(
      {
        ...(id ? { id } : {}),
        name: text(form, "name"),
        appliesTo: {
          kind: (text(form, "kind") || "page") as
            | "page"
            | "post"
            | "gallery"
            | "collection"
            | "tag"
            | "product",
          selector: text(form, "selector") || "*",
        },
        mode: (text(form, "mode") || "hard") as "hard" | "soft" | "metered" | "registration",
        meterCount: digits(form, "meterCount", 0),
        meterWindowDays: digits(form, "meterWindowDays", 30) || 30,
        previewStrategy: (text(form, "previewStrategy") || "blocks") as
          | "blocks"
          | "paragraphs"
          | "percent",
        previewValue: digits(form, "previewValue", 1),
        requiredEntitlementIds: entitlements,
        upsellPageId: text(form, "upsellPageId") || null,
        seoPolicy: (text(form, "seoPolicy") || "fully_gated") as
          | "flexible_sampling"
          | "fully_gated",
        status: (text(form, "status") || "active") as "active" | "archived",
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  done();
}
