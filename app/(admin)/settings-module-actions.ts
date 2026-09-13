// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin caller for module on/off (C11.09 F04). Core's refusal to switch itself
// off lives in the service, not here — the button is just how an owner asks.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { setModuleEnabled } from "@/core/settings/service";
import { ownerFacing } from "./action-helpers";

const SETTINGS = "/admin/settings";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function setModuleEnabledAction(form: FormData): Promise<void> {
  const moduleName = text(form, "module");
  const enabled = text(form, "enabled") === "true";
  try {
    await setModuleEnabled.call(
      { module: moduleName, enabled },
      await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value),
    );
  } catch (error) {
    const message =
      error instanceof ServiceError ? ownerFacing(error.message) : "That module could not be changed.";
    redirect(`${SETTINGS}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(SETTINGS);
  redirect(`${SETTINGS}?saved=module`);
}
