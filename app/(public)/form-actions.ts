// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The public form's door into the service layer (MASTER.md §11, §36).
//
// A Server Action rather than a JSON endpoint, for the same reason the setup
// wizard uses one: the form works before any JavaScript has loaded. For a
// contact form that matters more than most — the moment somebody decides to
// get in touch is the worst possible moment to spend on a hydration wait.
// Next verifies the request Origin for actions, so this path carries its own
// CSRF defence.
//
// The result is carried back in the URL and rendered by the block, so the
// public surface stays plain server-rendered HTML with no client component and
// no hydration boundary — which is what §5 and the SEO gate both rest on.
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { submitForm } from "@/modules/forms/service";
import { HONEYPOT_FIELD, STAMP_FIELD } from "@/modules/forms/antispam";
import { screenPublicSubmission } from "@/modules/forms/screening";
import {
  encodeFormReturn,
  FORM_RETURN_COOKIE,
  FORM_RETURN_MAX_AGE,
  publicFailure,
} from "@/core/http/public-form-return";
import { PATH_HEADER } from "@/core/http/headers";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../i18n";

/**
 * A signed-out visitor, carrying the request's client address so per-client
 * limits (the playground's among them) key on this visitor rather than on
 * one bucket every visitor shares.
 */
async function visitor() {
  return { kind: "anonymous" as const, request: requestMetadataFromHeaders(await headers()) };
}

/**
 * Only a code travels in the URL, never a message.
 *
 * A page that echoes arbitrary text from its own query string is a phishing
 * page waiting for a crafted link — "your payment failed, call this number" —
 * and no amount of escaping fixes that, because the text is not the attack.
 * Browsers enforce `required` and `type=email` natively, so the specific
 * validation messages are a backstop rather than the primary feedback.
 */
export async function submitPublicForm(form: FormData): Promise<void> {
  // FormData yields `string | File | null`, and a File would stringify to
  // "[object File]" — so the type is checked rather than coerced.
  const rawSlug = form.get("form_slug");
  const slug = typeof rawSlug === "string" ? rawSlug : "";
  const requestHeaders = await headers();
  const barePath = requestHeaders.get(PATH_HEADER) ?? "/";
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  const path = business
    ? localizeCustomerHref(barePath, locale, business)
    : barePath;

  const values: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key === "form_slug") continue;
    // A checkbox posts "on" when ticked and nothing at all when not, which is
    // not what a boolean field's validator expects.
    values[key] = value === "on" ? true : value;
  }

  // C3.33: the configured screening provider, if any, before the
  // submission's transaction opens. It returns a sealed verdict or nothing;
  // a provider that is down seals "unavailable" and the traps decide alone.
  const actor = await visitor();
  const screening = await screenPublicSubmission({ slug, values, request: actor.request });

  const jar = await cookies();
  try {
    await submitForm.call(
      { slug, values, sourceUrl: path, ...(screening ? { screening } : {}) },
      actor,
    );
  } catch (error) {
    // A coarse reason, never the service's text: "check your answers", "wait
    // a moment", "not available here" or "our fault". That is what a person
    // needs to know what to do next, and no more than the form's own fields
    // already say — the spam traps still answer "sent", and the owner sees
    // the real reason in the audit log either way.
    const failure = publicFailure(error);
    // Their answers come back with them, so a refusal is never also the loss
    // of a carefully written message. The traps are not echoed: refilling
    // them would mark the next, honest attempt as a bot.
    const kept = encodeFormReturn(`form:${slug}`, values, [HONEYPOT_FIELD, STAMP_FIELD]);
    if (kept) {
      jar.set(FORM_RETURN_COOKIE, kept, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: FORM_RETURN_MAX_AGE,
      });
    }
    redirect(`${path}?formError=${encodeURIComponent(slug)}&failure=${failure}`);
  }

  jar.delete(FORM_RETURN_COOKIE);
  redirect(`${path}?sent=${encodeURIComponent(slug)}`);
}
