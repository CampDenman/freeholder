// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// Analytics settings for the admin. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { setModuleConfig } from "@/core/settings/service";

/**
 * Choose whether traffic figures count programs as well as people.
 *
 * Stored as the analytics module's own configuration and validated against the
 * schema its manifest declares (§11), rather than as a query parameter — an
 * owner sets this once and expects every screen and every future report to
 * agree with the choice.
 */
export async function setIncludeBotsAction(form: FormData): Promise<void> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  await setModuleConfig.call(
    {
      module: "analytics",
      config: { includeBots: form.get("includeBots") === "1" },
    },
    actor,
  );
  revalidatePath("/admin/traffic");
}
