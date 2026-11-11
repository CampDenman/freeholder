// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { getT } from "../i18n";
import { ownerFacing } from "./action-helpers";
import {
  addPluginRegistry,
  cachePluginRegistry,
  disablePlugin,
  enablePlugin,
  installPlugin,
  rollbackPlugin,
  uninstallPlugin,
  updatePlugin,
} from "@/core/plugins/service";
import { revokePublisherKey, setRegistryPublisherKey, trustPublisherKey } from "@/core/plugins/publisher-keys";
import { approvePluginPermissions, revokePluginPermissions } from "@/core/plugins/permissions";

export interface PluginActionState {
  error?: string;
  saved?: boolean;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function pluginFailure(error: unknown): Promise<PluginActionState> {
  const t = await getT();
  if (error instanceof ServiceError) {
    if (error.code === "step_up_required") return { error: t("plugins.trust.verify") };
    if (error.code === "permission") return { error: t("plugins.signatureRefusal") };
    if (error.code === "validation" || error.code === "not_found") return { error: t("plugins.artifactInvalid") };
    if (error.code === "conflict") return { error: t("plugins.artifactConflict") };
  }
  return { error: t("plugins.operationError") };
}

export async function installPluginAction(
  _prev: PluginActionState,
  form: FormData,
): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    await installPlugin.call({ path: text(form, "path"), signature: text(form, "signature") || undefined }, actor);
    revalidatePath("/admin/plugins");
    return {};
  } catch (error) {
    return pluginFailure(error);
  }
}

export async function enablePluginAction(_prev: PluginActionState, form: FormData): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    await enablePlugin.call({ name: text(form, "name") }, actor);
    revalidatePath("/admin/plugins");
    return {};
  } catch (error) {
    return pluginFailure(error);
  }
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

export async function updatePluginAction(
  _prev: PluginActionState,
  form: FormData,
): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    await updatePlugin.call({ path: text(form, "path"), signature: text(form, "signature") || undefined }, actor);
    revalidatePath("/admin/plugins");
    return {};
  } catch (error) {
    return pluginFailure(error);
  }
}

export async function rollbackPluginAction(_prev: PluginActionState, form: FormData): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    await rollbackPlugin.call({ name: text(form, "name") }, actor);
    revalidatePath("/admin/plugins");
    return {};
  } catch (error) {
    return pluginFailure(error);
  }
}

export async function addPluginRegistryAction(
  _prev: PluginActionState,
  form: FormData,
): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const tier = text(form, "tier");
  try {
    await addPluginRegistry.call(
      {
        name: text(form, "name"),
        url: text(form, "url"),
        publisherKeyId: text(form, "publisherKeyId") || undefined,
        tier:
          tier === "verified" || tier === "private" || tier === "local"
            ? tier
            : "community",
      },
      actor,
    );
    revalidatePath("/admin/plugins");
    return {};
  } catch (error) {
    return {
      error: error instanceof ServiceError ? ownerFacing(error.message) : "That registry could not be added.",
    };
  }
}

async function publisherChange(work: () => Promise<unknown>): Promise<PluginActionState> {
  const t = await getT();
  try {
    await work();
    revalidatePath("/admin/plugins");
    return { saved: true };
  } catch (error) {
    if (error instanceof ServiceError) {
      const key = error.code === "step_up_required" ? "plugins.trust.verify"
        : error.code === "permission" ? "plugins.trust.denied"
        : error.code === "validation" ? "plugins.trust.invalid"
        : "plugins.trust.error";
      return { error: t(key) };
    }
    return { error: t("plugins.trust.error") };
  }
}

export async function trustPublisherKeyAction(_prev: PluginActionState, form: FormData): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return publisherChange(() => trustPublisherKey.call({
    publisher: text(form, "publisher"), publicKey: text(form, "publicKey"),
    fingerprint: text(form, "fingerprint"), confirmation: text(form, "confirmation") === "yes",
  }, actor));
}

export async function revokePublisherKeyAction(_prev: PluginActionState, form: FormData): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return publisherChange(() => revokePublisherKey.call({ keyId: text(form, "keyId"), confirmation: form.get("confirmation") === "on" }, actor));
}

export async function setRegistryPublisherKeyAction(_prev: PluginActionState, form: FormData): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return publisherChange(() => setRegistryPublisherKey.call({ id: text(form, "id"), keyId: text(form, "keyId") }, actor));
}

export async function cachePluginRegistryAction(_prev: PluginActionState, form: FormData): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const t = await getT();
  try {
    const index: unknown = JSON.parse(text(form, "index"));
    await cachePluginRegistry.call({ url: text(form, "url"), signature: text(form, "signature"), index }, actor);
    revalidatePath("/admin/plugins");
    return { saved: true };
  } catch {
    return { error: t("plugins.catalogRefusal") };
  }
}

async function permissionChange(work: () => Promise<unknown>): Promise<PluginActionState> {
  const t = await getT();
  try { await work(); revalidatePath("/admin/plugins"); return { saved: true }; }
  catch (error) { return { error: t(error instanceof ServiceError && error.code === "step_up_required" ? "plugins.permissions.verify" : "plugins.permissions.error") }; }
}

export async function approvePluginPermissionsAction(_prev: PluginActionState, form: FormData): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return permissionChange(() => approvePluginPermissions.call({ name: text(form, "name"), scopeHash: text(form, "scopeHash"), confirmation: form.get("confirmation") === "on" }, actor));
}

export async function revokePluginPermissionsAction(_prev: PluginActionState, form: FormData): Promise<PluginActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return permissionChange(() => revokePluginPermissions.call({ name: text(form, "name"), confirmation: form.get("confirmation") === "on" }, actor));
}
