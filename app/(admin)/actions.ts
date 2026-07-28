// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
// A file-level directive, unlike app/theme.ts: these are imported by client
// components, and an inline "use server" is only legal inside a Server
// Component. Every export here is therefore an action, which is what they are.
//
// Admin actions. Like the setup wizard, these go through the same services the
// REST API and MCP server call (§11) — the admin is a caller, never a
// shortcut. Next verifies the Origin header for Server Actions, so this path
// carries its own CSRF defence.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout } from "@/core/auth/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { createContact, updateContact } from "@/core/contacts/service";
import { patchBusiness } from "@/core/settings/service";
import { ServiceError } from "@/core/service";

export interface ActionState {
  error?: string;
  saved?: boolean;
  /**
   * What the caller typed, handed back on failure.
   *
   * React resets a form after its action runs — every time, success or not —
   * so without this an owner who mistypes one field loses the whole record
   * they just filled in. `attempt` changes on each failure so the inputs
   * remount and pick the returned values up.
   */
  values?: Record<string, string>;
  attempt?: number;
}

function present(error: unknown): ActionState {
  if (error instanceof ServiceError) return { error: error.message };
  console.error("admin action failed", error);
  return { error: "Something went wrong. Try again." };
}

function field(form: FormData, key: string, fallback = ""): string {
  const value = form.get(key);
  return typeof value === "string" ? value : fallback;
}

/** Hand a form's own text back, so a rejected save does not discard it. */
function echo(
  previous: ActionState,
  form: FormData,
): Pick<ActionState, "values" | "attempt"> {
  const values: Record<string, string> = {};
  for (const key of form.keys()) {
    // Never a password: echoing one would put it in the rendered HTML.
    if (key === "password") continue;
    values[key] = field(form, key);
  }
  return { values, attempt: (previous.attempt ?? 0) + 1 };
}

async function currentActor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function signInAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let token: string;
  let expiresAt: Date;
  try {
    const result = await login.call(
      { email: field(form, "email"), password: field(form, "password") },
      { kind: "anonymous" },
    );
    token = result.token;
    expiresAt = result.expiresAt;
  } catch (error) {
    // Same reason as the contact form: React resets the form, and retyping an
    // address after a mistyped password is a needless indignity. `echo` never
    // returns the password.
    return { ...present(error), ...echo(_previous, form) };
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
  jar.set(CSRF_COOKIE, issueCsrfToken(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure,
    expires: expiresAt,
  });
  redirect("/admin");
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    // Through the service, so the session row is actually revoked rather than
    // just forgotten by this browser.
    await logout.call({ token }, await currentActor()).catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
  redirect("/login");
}

export async function saveBusinessSettingsAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locales = field(form, "enabledLocales", "en")
    .split(",")
    .map((locale) => locale.trim())
    .filter(Boolean);

  try {
    await patchBusiness.call(
      {
        name: field(form, "name"),
        tagline: field(form, "tagline") || undefined,
        schemaType: field(form, "schemaType"),
        country: field(form, "country"),
        baseCurrency: field(form, "baseCurrency"),
        timezone: field(form, "timezone"),
        defaultLocale: locales[0] ?? "en",
        enabledLocales: locales,
        units: field(form, "units", "metric") as "metric" | "imperial",
        firstDayOfWeek: Number(field(form, "firstDayOfWeek", "1")),
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(_previous, form) };
  }
  return { saved: true };
}

const STAGES = ["lead", "prospect", "customer", "repeat"] as const;
type Stage = (typeof STAGES)[number];

function stageOf(form: FormData): Stage {
  const value = field(form, "lifecycleStage", "lead");
  return (STAGES as readonly string[]).includes(value)
    ? (value as Stage)
    : "lead";
}

function tagsOf(form: FormData): string[] {
  return field(form, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function createContactAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  let id: string;
  try {
    const contact = await createContact.call(
      {
        name: field(form, "name"),
        email: field(form, "email") || undefined,
        phone: field(form, "phone") || undefined,
        lifecycleStage: stageOf(form),
        tags: tagsOf(form),
        ownerNotes: field(form, "ownerNotes") || undefined,
        source: "admin",
      },
      await currentActor(),
    );
    id = contact.id;
  } catch (error) {
    return { ...present(error), ...echo(_previous, form) };
  }
  redirect(`/admin/contacts/${id}`);
}

export async function updateContactAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await updateContact.call(
      {
        id: field(form, "id"),
        name: field(form, "name"),
        email: field(form, "email") || undefined,
        phone: field(form, "phone") || undefined,
        lifecycleStage: stageOf(form),
        tags: tagsOf(form),
        ownerNotes: field(form, "ownerNotes") || undefined,
      },
      await currentActor(),
    );
  } catch (error) {
    return { ...present(error), ...echo(_previous, form) };
  }
  return { saved: true };
}
