// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// First-boot actions (MASTER.md §13). These are the browser's door into the
// same services the REST API and MCP server call — the choke point holds
// (§11), and nothing here touches a table.
//
// Server Actions rather than fetch() on purpose: the form works before any
// JavaScript has loaded, which is exactly the property the first screen of a
// fresh deploy needs. Next verifies the request Origin for actions, so this
// path carries its own CSRF defence without the token dance the JSON API uses.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { registerOwner } from "@/core/auth/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { completeSetup, updateBusiness } from "@/core/settings/service";
import { ServiceError } from "@/core/service";

export interface ActionState {
  error?: string;
}

/**
 * A form field as text. FormData yields `string | File | null`, and a field
 * that arrives as a File would stringify to "[object File]" — so the type is
 * checked rather than coerced.
 */
function text(form: FormData, key: string, fallback = ""): string {
  const value = form.get(key);
  return typeof value === "string" ? value : fallback;
}

/** Service failures are written for the caller; anything else is a bug. */
function present(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  console.error("setup action failed", error);
  return { error: "Something went wrong. Try again." };
}

export async function createOwnerAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let token: string;
  let expiresAt: Date;
  try {
    const result = await registerOwner.call(
      {
        email: text(form, "email", ""),
        password: text(form, "password", ""),
      },
      { kind: "anonymous" },
    );
    token = result.token;
    expiresAt = result.expiresAt;
  } catch (error) {
    return present(error);
  }

  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: expiresAt,
  });
  // Readable by design: the JSON API expects this echoed in a header.
  jar.set(CSRF_COOKIE, issueCsrfToken(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure,
    expires: expiresAt,
  });

  redirect("/setup/business");
}

export async function saveBusinessAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  const locales = text(form, "locales", "en")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);

  try {
    await updateBusiness.call(
      {
        name: text(form, "name", ""),
        tagline: text(form, "tagline") || undefined,
        schemaType: text(form, "schemaType", "LocalBusiness"),
        country: text(form, "country", ""),
        baseCurrency: text(form, "baseCurrency", ""),
        timezone: text(form, "timezone", ""),
        defaultLocale: locales[0] ?? "en",
        enabledLocales: locales,
        units: text(form, "units", "metric") as "metric" | "imperial",
        firstDayOfWeek: Number(text(form, "firstDayOfWeek", "1")),
      },
      actor,
    );
  } catch (error) {
    return present(error);
  }
  redirect("/setup/done");
}

export async function completeSetupAction(
  _previous: ActionState,
  _form: FormData,
): Promise<ActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  try {
    await completeSetup.call({}, actor);
  } catch (error) {
    return present(error);
  }
  redirect("/");
}
