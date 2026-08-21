// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the briefing screen (C4.15). Ownership, preferences and
// read state are enforced in the services shared with HTTP and MCP.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { markBriefingRead, setBriefingSection } from "@/core/briefing/service";

const BRIEFING = "/admin/briefing";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function markBriefingReadAction(form: FormData): Promise<void> {
  try {
    await markBriefingRead.call({ id: text(form, "id") }, await actor());
  } catch {
    redirect(`${BRIEFING}?error=read`);
  }
  revalidatePath(BRIEFING);
  redirect(BRIEFING);
}

export async function setBriefingSectionAction(form: FormData): Promise<void> {
  try {
    await setBriefingSection.call(
      { key: text(form, "key"), enabled: text(form, "enabled") === "true" },
      await actor(),
    );
  } catch {
    redirect(`${BRIEFING}?error=section`);
  }
  revalidatePath(BRIEFING);
  redirect(BRIEFING);
}
