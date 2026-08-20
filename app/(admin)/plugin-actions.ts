// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { ownerFacing } from "./action-helpers";
import {
  disablePlugin,
  enablePlugin,
  installPlugin,
  uninstallPlugin,
} from "@/core/plugins/service";

export interface PluginActionState {
  error?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function installPluginAction(
  _prev: PluginActionState,
  form: FormData,
): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    await installPlugin.call({ path: text(form, "path") }, actor);
    revalidatePath("/admin/plugins");
    return {};
  } catch (error) {
    return {
      error: error instanceof ServiceError ? ownerFacing(error.message) : "That plugin could not be installed.",
    };
  }
}

export async function enablePluginAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  await enablePlugin.call({ name: text(form, "name") }, actor);
  revalidatePath("/admin/plugins");
}

export async function disablePluginAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  await disablePlugin.call({ name: text(form, "name") }, actor);
  revalidatePath("/admin/plugins");
}

export async function uninstallPluginAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const retention = text(form, "retention") === "purge" ? "purge" : "keep";
  await uninstallPlugin.call({ name: text(form, "name"), retention }, actor);
  revalidatePath("/admin/plugins");
}
