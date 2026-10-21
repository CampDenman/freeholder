// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The admin's sharing controls. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { SHARE_CHANNELS } from "@/modules/share/intents";
import { forgetTarget, saveTarget } from "@/modules/share/service";

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

function done(returnTo: string, error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("share action failed");
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}saved=1`);
}

/**
 * The channels an owner ticked.
 *
 * Nothing ticked means nothing shared, which is a real thing to want, and it
 * is distinguishable from "all of them" because the service normalises a full
 * set back to the null default. The form always posts the whole set of
 * checkboxes, so an unticked box is an absence rather than a stale value.
 */
function channelsFrom(form: FormData): string[] {
  const chosen = new Set(
    form.getAll("channel").filter((value): value is string => typeof value === "string"),
  );
  return SHARE_CHANNELS.filter((channel) => chosen.has(channel));
}

export async function saveShareTargetAction(form: FormData): Promise<void> {
  const path = text(form, "path");
  const returnTo = `/admin/sharing?path=${encodeURIComponent(path)}`;
  try {
    await saveTarget.call(
      {
        path,
        locale: text(form, "locale") || "en",
        entityKind: text(form, "entityKind") || "page",
        shareable: form.get("shareable") === "on",
        channels: channelsFrom(form),
        socialTitle: optional(form, "socialTitle"),
        socialDescription: optional(form, "socialDescription"),
        imageUrl: optional(form, "imageUrl"),
      },
      await actor(),
    );
  } catch (error) {
    done(returnTo, error);
  }
  revalidatePath("/admin/sharing");
  done(returnTo);
}

/**
 * The one-click switch on the list.
 *
 * A separate action from the editor because it is the control an owner reaches
 * for in a hurry — a photograph that should not be circulating — and making
 * them open a form first would be ceremony at exactly the wrong moment.
 */
export async function setShareableAction(form: FormData): Promise<void> {
  try {
    await saveTarget.call(
      {
        path: text(form, "path"),
        locale: text(form, "locale") || "en",
        entityKind: text(form, "entityKind") || "page",
        shareable: text(form, "shareable") === "1",
        channels: channelsFrom(form),
        socialTitle: optional(form, "socialTitle"),
        socialDescription: optional(form, "socialDescription"),
        imageUrl: optional(form, "imageUrl"),
      },
      await actor(),
    );
  } catch (error) {
    done("/admin/sharing", error);
  }
  revalidatePath("/admin/sharing");
  done("/admin/sharing");
}

export async function forgetShareTargetAction(form: FormData): Promise<void> {
  try {
    await forgetTarget.call(
      { id: text(form, "id"), confirm: form.get("confirm") === "on" },
      await actor(),
    );
  } catch (error) {
    done("/admin/sharing", error);
  }
  revalidatePath("/admin/sharing");
  done("/admin/sharing");
}
