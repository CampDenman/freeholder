// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.01: joining the site as a member.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { joinSite, updateMyMembership } from "@/modules/members/service";
import { VISIBILITIES, type Visibility } from "@/modules/members/visibility";
import { getLocale } from "../../i18n";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function localized(path: string): Promise<string> {
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  return business ? localizeCustomerHref(path, locale, business) : path;
}

function visibility(value: string): Visibility | undefined {
  return (VISIBILITIES as readonly string[]).includes(value) ? (value as Visibility) : undefined;
}

function code(error: unknown): string {
  return error instanceof ServiceError ? error.code : "failed";
}

export async function joinSiteAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  let failed: string | null = null;
  try {
    await joinSite.call(
      {
        handle: text(form, "handle"),
        displayName: text(form, "displayName"),
        meetsMinimumAge: (form.get("meetsMinimumAge") === "yes") as true,
        isAdult: form.get("isAdult") === "yes",
      },
      actor,
    );
  } catch (error) {
    failed = code(error);
  }
  redirect(await localized(failed ? `/join?error=${failed}` : "/portal/member?joined=1"));
}

export async function updateMemberProfileAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  let failed: string | null = null;
  try {
    await updateMyMembership.call(
      {
        displayName: text(form, "displayName"),
        bio: text(form, "bio"),
        handle: text(form, "handle") || undefined,
        isAdult: form.get("isAdult") === "yes",
        isPrivate: form.get("isPrivate") === "yes",
        indexable: form.get("indexable") === "yes",
        readReceipts: form.get("readReceipts") === "yes",
        showAdult: form.get("showAdult") === "yes",
        bioVisibility: visibility(text(form, "bioVisibility")),
        linksVisibility: visibility(text(form, "linksVisibility")),
        defaultPostVisibility: visibility(text(form, "defaultPostVisibility")),
        links: [0, 1, 2]
          .map((i) => ({ label: text(form, `linkLabel${i}`).trim(), url: text(form, `linkUrl${i}`).trim() }))
          .filter((link) => link.label && link.url),
      },
      actor,
    );
  } catch (error) {
    failed = code(error);
  }
  redirect(await localized(failed ? `/portal/member?error=${failed}` : "/portal/member?saved=1"));
}
