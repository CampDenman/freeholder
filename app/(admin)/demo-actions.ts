// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import {
  loadDemoScenario,
  purgeDemoScenario,
  reloadDemoScenario,
  resetDemoScenario,
} from "@/core/demo/service";
import { ServiceError } from "@/core/service";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function currentActor() {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  return { ...actor, request: requestMetadataFromHeaders(await headers()) };
}

export async function demoScenarioAction(form: FormData): Promise<void> {
  const intent = field(form, "intent");
  const key = field(form, "key");
  const locale = field(form, "locale") || undefined;
  try {
    const actor = await currentActor();
    if (intent === "load") await loadDemoScenario.call({ key, locale }, actor);
    else if (intent === "reload") await reloadDemoScenario.call({}, actor);
    else if (intent === "reset") {
      await resetDemoScenario.call({ key, locale }, actor);
    } else if (intent === "purge") await purgeDemoScenario.call({}, actor);
    else throw new ServiceError("validation", "Choose a demo action.");
  } catch (error) {
    const code = error instanceof ServiceError ? error.code : "failed";
    redirect(`/admin/demos?error=${encodeURIComponent(code)}`);
  }
  revalidatePath("/", "layout");
  revalidatePath("/admin", "layout");
  redirect(`/admin/demos?status=${encodeURIComponent(intent)}`);
}
