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
import { after } from "next/server";
import { submitForm } from "@/modules/forms/service";
import {
  acceptedSubmissionIdentity,
  screenPublicSubmission,
} from "@/modules/forms/paradise";
import {
  clickIdsFromCookie,
  PARADISE_CLICK_ID_COOKIE,
  paradiseMeasurement,
  paradiseMeasurementAllowed,
  sendLeadConversion,
} from "@/modules/analytics/paradise";
import { currentAnalyticsSettings } from "@/modules/analytics/read";
import {
  ANALYTICS_CONSENT_COOKIE,
  parseAnalyticsConsentState,
} from "@/modules/analytics/visitor";
import { env } from "@/core/env";
import { PATH_HEADER } from "@/core/http/headers";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../i18n";

const ANONYMOUS = { kind: "anonymous" } as const;

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

  // C3.32: PM Shield, when the owner turned it on, before the submission's
  // transaction opens. It returns a sealed verdict or nothing; PM being down
  // seals "unavailable" and the site's own traps decide alone.
  const request = requestMetadataFromHeaders(requestHeaders);
  const screening = await screenPublicSubmission({ slug, values, request });

  let submissionId: string;
  try {
    ({ submissionId } = await submitForm.call(
      { slug, values, sourceUrl: path, ...(screening ? { screening } : {}) },
      ANONYMOUS,
    ));
  } catch {
    // Deliberately not distinguishing between validation, rate limiting and a
    // genuine fault in the redirect: a public form that reports *why* it
    // refused a submission is also telling a script how to get past it.
    // The owner sees the real reason in the audit log either way.
    redirect(`${path}?formError=${encodeURIComponent(slug)}`);
  }

  // C3.31: a `lead` conversion, only for a visitor who explicitly allowed
  // measurement, and only after the response is on its way — the visitor
  // never waits for it, and nothing about them is stored to send it later.
  const cookieJar = await cookies();
  const consent = parseAnalyticsConsentState(cookieJar.get(ANALYTICS_CONSENT_COOKIE)?.value);
  if (
    paradiseMeasurement() &&
    paradiseMeasurementAllowed((await currentAnalyticsSettings()).consentPolicy, consent)
  ) {
    const clickIds = clickIdsFromCookie(cookieJar.get(PARADISE_CLICK_ID_COOKIE)?.value);
    const sourceUrl = new URL(path, env().APP_URL).href;
    after(async () => {
      try {
        const identity = await acceptedSubmissionIdentity(submissionId);
        if (!identity) return;
        await sendLeadConversion({
          submissionId,
          ...identity,
          ip: request.trustedIp ?? request.ip,
          userAgent: request.userAgent,
          sourceUrl,
          clickIds,
        });
      } catch {
        // Attribution is best effort; the enquiry itself is already safe.
      }
    });
  }

  redirect(`${path}?sent=${encodeURIComponent(slug)}`);
}
