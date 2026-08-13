// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Analytics settings for the admin. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { setModuleConfig } from "@/core/settings/service";
import { currentAnalyticsSettings } from "@/modules/analytics/read";
import { correctClassification } from "@/modules/analytics/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Choose whether traffic figures count programs as well as people.
 *
 * Stored as the analytics module's own configuration and validated against the
 * schema its manifest declares (§11), rather than as a query parameter — an
 * owner sets this once and expects every screen and every future report to
 * agree with the choice.
 */
export async function setIncludeBotsAction(form: FormData): Promise<void> {
  const [caller, current] = await Promise.all([actor(), currentAnalyticsSettings()]);
  await setModuleConfig.call(
    {
      module: "analytics",
      config: { ...current, includeBots: form.get("includeBots") === "1" },
    },
    caller,
  );
  revalidatePath("/admin/traffic");
}

export async function setAnalyticsPolicyAction(form: FormData): Promise<void> {
  const [caller, current] = await Promise.all([actor(), currentAnalyticsSettings()]);
  await setModuleConfig.call(
    {
      module: "analytics",
      config: {
        ...current,
        consentPolicy: textField(form, "consentPolicy"),
        retentionDays: Number(textField(form, "retentionDays")),
      },
    },
    caller,
  );
  revalidatePath("/admin/traffic");
}

export async function correctAnalyticsClassificationAction(
  form: FormData,
): Promise<void> {
  await correctClassification.call(
    {
      eventId: textField(form, "eventId"),
      kind: textField(form, "kind") || "automatic",
      classificationNote: textField(form, "classificationNote"),
    },
    await actor(),
  );
  revalidatePath("/admin/traffic");
}
