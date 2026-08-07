// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Reading and writing the theme preference — the only place `next/headers`
// touches theming, so src/ stays framework-free (§10).
//
// Note there is no file-level "use server": that would turn *every* export
// here into a publicly callable endpoint, including the read helper, which is
// only ever meant to run during render. The directive sits inside the one
// function that really is an action.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  parseThemePreference,
  THEME_COOKIE,
  type ThemePreference,
} from "@/core/design/theme";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function readThemePreference(): Promise<ThemePreference> {
  const jar = await cookies();
  return parseThemePreference(jar.get(THEME_COOKIE)?.value);
}

export async function setThemeAction(formData: FormData): Promise<void> {
  "use server";
  const raw = formData.get("theme");
  const preference = parseThemePreference(
    typeof raw === "string" ? raw : undefined,
  );
  const jar = await cookies();

  if (preference === "system") {
    // Deleting rather than storing "system": the absence of a cookie is what
    // lets prefers-color-scheme keep deciding as the visitor's OS changes.
    jar.delete(THEME_COOKIE);
  } else {
    jar.set(THEME_COOKIE, preference, {
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
      sameSite: "lax",
      // Readable by design — it is a display preference, not a credential.
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
    });
  }

  const target = formData.get("returnTo");
  // A path on this site and nothing else: accepting a full URL here would make
  // this an open redirect.
  const safe =
    typeof target === "string" && /^\/(?!\/)/.test(target) ? target : "/";
  redirect(safe);
}
