// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import {
  dismissGuidance,
  resetGuidance,
  startGuidance,
} from "@/core/guidance/service";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function safeReturnTo(value: string): string {
  return /^\/admin(?:[/?#]|$)/.test(value) && !value.startsWith("//")
    ? value
    : "/admin/guidance";
}

async function currentActor() {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  return {
    ...actor,
    request: requestMetadataFromHeaders(await headers()),
  };
}

export async function adminGuidanceAction(form: FormData): Promise<void> {
  const flowKey = field(form, "flowKey");
  const intent = field(form, "intent");
  const returnTo = safeReturnTo(field(form, "returnTo"));
  try {
    const actor = await currentActor();
    if (intent === "start") await startGuidance.call({ flowKey }, actor);
    else if (intent === "dismiss") await dismissGuidance.call({ flowKey }, actor);
    else if (intent === "reset") await resetGuidance.call({ flowKey }, actor);
    else throw new ServiceError("validation", "Choose a guidance action.");
  } catch (error) {
    const code = error instanceof ServiceError ? error.code : "failed";
    redirect(`/admin/guidance?error=${encodeURIComponent(code)}`);
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/admin/guidance");
  redirect(returnTo);
}
