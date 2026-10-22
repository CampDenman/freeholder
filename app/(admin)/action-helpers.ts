// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared plumbing for admin server actions.
import { headers } from "next/headers";
import { safeLocalPath } from "@/core/http/local-path";

/**
 * A service message with its machine addressing removed.
 *
 * `defineService` prefixes a rejected input with the service name and the
 * failing path — `forms.update: fields: The field "x" is…` — which is right
 * for an API caller and noise above a text box. The sentence after it was
 * written for a person, so that is what an owner is shown.
 *
 * This helper existed as six identical private copies across the action
 * files before it was drawn together here. The general fix remains catalog
 * keys for service errors (the audit's batch-6 programme): until every
 * ServiceError message has a key in the locale catalogs, this at least keeps
 * the one transformation consistent and in one place.
 */
export function ownerFacing(message: string): string {
  return message.replace(/^[a-z][\w.]*: (?:[\w.[\]]+: )?/, "");
}

/**
 * The admin screen whose form posted this action, for sending a refusal back
 * where the person was rather than to whichever screen an action file
 * happens to default to (a coupon refused on Promotions used to land on "New
 * product"). The browser's same-origin Referer names it; anything else —
 * absent, foreign, or not a local path — falls back. Stale `error` and
 * `saved` flags are dropped so the new outcome is the only one shown.
 */
export async function postedFromPath(fallback: string): Promise<string> {
  const requestHeaders = await headers();
  const referer = requestHeaders.get("referer");
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (!host || url.host !== host || !url.pathname.startsWith("/admin")) return fallback;
    url.searchParams.delete("error");
    url.searchParams.delete("saved");
    const query = url.searchParams.toString();
    return safeLocalPath(`${url.pathname}${query ? `?${query}` : ""}`, fallback);
  } catch {
    return fallback;
  }
}
