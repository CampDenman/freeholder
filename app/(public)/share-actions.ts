// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The public share bar's one verb. Thin, like every other caller (§11).
//
// A server action rather than a POST route because it has to work with
// JavaScript off — §34 puts sharing on every public page, and a share button
// that needs a bundle is a share button half the visitors on a train never
// see. Next posts the form, this runs on the server, and the visitor is
// redirected either to the channel or back to the page holding the link.
//
// The actor is resolved from the session rather than taken from the form. A
// signed-in customer sharing their own gallery is recorded as themselves; a
// stranger is recorded as nobody. Nothing in the form can claim to be a
// contact, because a forged sharer would be a forged row on the spine.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { PATH_HEADER } from "@/core/http/headers";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { shareChannelSchema } from "@/modules/share/intents";
import { shareVia } from "@/modules/share/service";
import { getLocale } from "../i18n";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function shareEntityAction(form: FormData): Promise<void> {
  const channel = shareChannelSchema.safeParse(field(form, "channel"));
  const requestHeaders = await headers();
  const barePath = requestHeaders.get(PATH_HEADER) ?? "/";
  const [business, locale, actor] = await Promise.all([
    currentBusiness(),
    getLocale(),
    actorFromToken((await cookies()).get(SESSION_COOKIE)?.value),
  ]);
  const back = business ? localizeCustomerHref(barePath, locale, business) : barePath;
  const join = back.includes("?") ? "&" : "?";
  if (!channel.success) redirect(`${back}${join}shareError=1`);

  try {
    const shared = await shareVia.call(
      {
        // The path comes from the request, never from the form: the form is
        // whatever a stranger posted, and this decides which entity's sharing
        // setting is consulted.
        path: barePath,
        locale,
        channel: channel.data,
        title: field(form, "title").slice(0, 200),
      },
      actor,
    );
    // A channel intent is a fixed host from `intents.ts`; nothing a caller
    // sent can change its origin. On-site channels — copy and the native
    // share sheet — come back here with the link to hand over.
    redirect(shared.intentUrl ?? `${back}${join}shared=${shared.ref}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`${back}${join}shareError=1`);
  }
}
