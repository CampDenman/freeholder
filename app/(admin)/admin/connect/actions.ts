// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createApiKey } from "@/core/apikeys/service";
import { connectionScopes, CONNECTION_PROFILES } from "@/core/apikeys/profiles";
import { listExternalServices, permits, ServiceError } from "@/core/service";
import { hiddenFromMcp } from "@/mcp/tools";
import { requireStaffActor } from "../guard";

export interface ConnectionState { token?: string; scopes?: string[]; error?: string; stepUp?: boolean }
export async function createConnectionAction(_previous: ConnectionState, form: FormData): Promise<ConnectionState> {
  const actor = await requireStaffActor("apikeys", "manage");
  const parsed = z.object({ name: z.string().trim().min(1).max(80), profile: z.enum(CONNECTION_PROFILES), days: z.coerce.number().int().min(1).max(365) }).safeParse({ name: form.get("name"), profile: form.get("profile"), days: form.get("days") });
  if (!parsed.success) return { error: "Choose a connection name, permission preset and expiry." };
  const services = [...listExternalServices().values()].filter((service) => !hiddenFromMcp(service) && service.def.permission !== "authenticated" && permits(actor, service.def.permission, service.def.name, service.def.kind));
  const scopes = connectionScopes(parsed.data.profile, services.map((service) => ({ name: service.def.name, kind: service.def.kind })));
  if (!scopes.length) return { error: "This instance has no available tools for that preset." };
  try {
    const key = await createApiKey.call({ name: parsed.data.name, scopes, expiresInDays: parsed.data.days }, actor);
    revalidatePath("/admin/settings");
    return { token: key.token, scopes };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message, stepUp: error.code === "step_up_required" };
    console.error("agent connection failed");
    return { error: "That connection could not be created. Try again." };
  }
}
