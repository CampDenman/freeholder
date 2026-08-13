// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// First-boot actions (MASTER.md §13). These are the browser's door into the
// same services the REST API and MCP server call — the choke point holds
// (§11), and nothing here touches a table.
//
// Server Actions rather than fetch() on purpose: the form works before any
// JavaScript has loaded, which is exactly the property the first screen of a
// fresh deploy needs. Next verifies the request Origin for actions, so this
// path carries its own CSRF defence without the token dance the JSON API uses.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { registerOwner } from "@/core/auth/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { completeSetup, updateBusiness } from "@/core/settings/service";
import { createLocationService } from "@/core/locations/service";
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
      {
        kind: "anonymous",
        request: requestMetadataFromHeaders(await headers()),
      },
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
  redirect("/setup/location");
}

/**
 * §13 step 4, and the one step that is allowed to write nothing.
 *
 * Skipping and saving are the same submit, because the alternative — a link
 * out of the form — leaves whatever was typed looking as though it had been
 * kept. An empty form is also a skip: an owner who reads the screen, decides
 * it does not apply and presses the main button should not get a location row
 * with nothing in it, which would put an empty address block on their site
 * (§4.10).
 */
export async function saveSetupLocationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const skipped = text(form, "skip") === "1";
  const street = text(form, "street").trim();
  const city = text(form, "city").trim();
  const phone = text(form, "phone").trim();
  const country = text(form, "country").trim().toUpperCase();

  if (!skipped && (street || city || phone)) {
    const actor = await actorFromToken(
      (await cookies()).get(SESSION_COOKIE)?.value,
    );
    try {
      await createLocationService.call(
        {
          name: text(form, "name", ""),
          // The site address is derived rather than asked for: nobody setting
          // up a business has an opinion about it yet, and it is one field
          // fewer between them and a working site. The admin screen can
          // change it later, and moving it leaves a redirect.
          slug: slugify(city || text(form, "name", "") || "main"),
          street: street || null,
          city: city || null,
          region: text(form, "region").trim() || null,
          postalCode: text(form, "postalCode").trim() || null,
          country,
          phone: phone || null,
          isPrimary: true,
        },
        actor,
      );
    } catch (error) {
      return present(error);
    }
  }

  redirect("/setup/done");
}

/** A name as a URL segment. Accents are folded, not dropped, so "Montréal" is montreal. */
function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "main"
  );
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
