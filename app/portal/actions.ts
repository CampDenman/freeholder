// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  CUSTOMER_MAGIC_COOKIE,
  consumeCustomerMagicLink,
  requestCustomerMagicLink,
} from "@/core/auth/magic-links/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { logout } from "@/core/auth/service";
import { actorFromToken } from "@/core/http/actor";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import {
  cancelMyDataRequest,
  createMyDataRequest,
  setMyMarketingPreference,
} from "@/core/privacy/service";
import { getLocale, getT, requestedLocale } from "../i18n";
import { setMyLocale } from "@/core/i18n/service";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import {
  dismissGuidance,
  resetGuidance,
  startGuidance,
} from "@/core/guidance/service";
import { getSignupContactImportOffer } from "@/core/import/signup-contact-service";

export interface MagicLinkState {
  sent?: boolean;
  error?: string;
}

export interface PrivacyActionState {
  saved?: boolean;
  message?: string;
  error?: string;
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function currentPortalActor() {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  return {
    ...actor,
    request: requestMetadataFromHeaders(await headers()),
  };
}

export async function requestMagicLinkAction(
  _previous: MagicLinkState,
  form: FormData,
): Promise<MagicLinkState> {
  try {
    const locale = await getLocale();
    await requestCustomerMagicLink.call(
      { email: field(form, "email"), locale },
      {
        kind: "anonymous",
        request: requestMetadataFromHeaders(await headers()),
      },
    );
  } catch (error) {
    if (error instanceof ServiceError && error.code === "rate_limited") {
      return { error: (await getT())("portal.login.rateLimited") };
    }
    // Delivery errors must not reveal that this address was the one that
    // reached the mail adapter while an unknown address did not.
    console.error("customer magic-link request failed", error);
  }
  return { sent: true };
}

export async function confirmMagicLinkAction(
  _previous: MagicLinkState,
  _form: FormData,
): Promise<MagicLinkState> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_MAGIC_COOKIE)?.value;
  const [t, askedLocale] = await Promise.all([
    getT(),
    requestedLocale(),
  ]);
  if (!token) return { error: t("portal.magic.unavailable") };
  let result;
  try {
    result = await consumeCustomerMagicLink.call(
      { token },
      {
        kind: "anonymous",
        request: requestMetadataFromHeaders(await headers()),
      },
    );
  } catch (error) {
    return {
      error:
        error instanceof ServiceError
          ? t("portal.magic.unavailable")
          : t("portal.magic.failed"),
    };
  }
  const secure = process.env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    expires: result.expiresAt,
  });
  jar.set(CSRF_COOKIE, issueCsrfToken(), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure,
    expires: result.expiresAt,
  });
  jar.set(CUSTOMER_MAGIC_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    // Clear the exact path where the GET staged it. Even a tampered/disabled
    // locale prefix must not leave a spent bearer cookie behind.
    path: askedLocale ? `/${askedLocale}/portal` : "/portal",
    secure,
    maxAge: 0,
  });
  if (result.linked) {
    try {
      const offer = await getSignupContactImportOffer.call(
        {},
        {
          kind: "user",
          userId: result.userId,
          role: "customer",
          grants: [],
          sessionId: result.sessionId,
        },
      );
      if (offer.enabled && offer.decision === null) {
        redirect(localizeCustomerHref("/portal/contact-import", result.locale, result));
      }
    } catch (error) {
      // Account creation is already complete. An optional offer being
      // unavailable must never turn a successful signup into a failed one.
      if (typeof error === "object" && error !== null && "digest" in error) throw error;
      console.error("post-signup contact import offer could not be read", error);
    }
  }
  redirect(localizeCustomerHref("/portal/login", result.locale, result));
}

export async function setPortalLocaleAction(form: FormData): Promise<void> {
  const selected = field(form, "locale");
  const rawReturnTo = field(form, "returnTo");
  const returnTo = /^\/portal(?:\/|$)/.test(rawReturnTo)
    ? rawReturnTo
    : "/portal/login";
  const result = await setMyLocale.call(
    { locale: selected },
    await currentPortalActor(),
  );
  revalidatePath("/portal", "layout");
  redirect(localizeCustomerHref(returnTo, result.locale, result));
}

export async function portalPrivacyAction(
  _previous: PrivacyActionState,
  form: FormData,
): Promise<PrivacyActionState> {
  const intent = field(form, "intent");
  let messageKey: string;
  try {
    const actor = await currentPortalActor();
    if (intent === "preference") {
      await setMyMarketingPreference.call(
        {
          channel: field(form, "channel") as "email" | "sms" | "push",
          state: field(form, "state") as "granted" | "withdrawn",
          termsVersion: "portal-privacy-v1",
        },
        actor,
      );
      messageKey = "privacy.portal.preferenceSaved";
    } else if (intent === "request") {
      const kind = field(form, "kind") as
        | "access"
        | "export"
        | "correction"
        | "erasure";
      const note = field(form, "note") || undefined;
      const name = field(form, "name") || undefined;
      const email = field(form, "clearEmail") === "on"
        ? null
        : field(form, "email") || undefined;
      const phone = field(form, "clearPhone") === "on"
        ? null
        : field(form, "phone") || undefined;
      const preferredLocale = field(form, "preferredLocale") || undefined;
      const timezone = field(form, "timezone") || undefined;
      const country = field(form, "country") || undefined;
      await createMyDataRequest.call(
        {
          jurisdiction: field(form, "jurisdiction") || null,
          request:
            kind === "correction"
              ? {
                  kind,
                  note,
                  changes: {
                    name,
                    email,
                    phone,
                    preferredLocale,
                    timezone,
                    country,
                  },
                }
              : { kind, note },
        },
        actor,
      );
      messageKey = "privacy.portal.requestSaved";
    } else if (intent === "cancel") {
      await cancelMyDataRequest.call(
        { id: field(form, "requestId") },
        actor,
      );
      messageKey = "privacy.portal.requestCancelled";
    } else {
      throw new ServiceError("validation", "Choose a privacy action.");
    }
  } catch (error) {
    const t = await getT();
    return {
      error:
        error instanceof ServiceError && error.code === "rate_limited"
          ? t("common.tryAgainLater")
          : t("common.somethingWentWrong"),
    };
  }
  revalidatePath("/portal/privacy");
  const t = await getT();
  return { saved: true, message: t(messageKey) };
}

export async function portalGuidanceAction(form: FormData): Promise<void> {
  const flowKey = field(form, "flowKey");
  const intent = field(form, "intent");
  const rawReturnTo = field(form, "returnTo");
  const returnTo = /^\/(?:[A-Za-z]{2}(?:-[A-Za-z]{2,4})?\/)?portal(?:[/?#]|$)/
    .test(rawReturnTo) && !rawReturnTo.startsWith("//")
    ? rawReturnTo
    : "/portal/privacy#guidance";
  const actor = await currentPortalActor();
  if (intent === "start") await startGuidance.call({ flowKey }, actor);
  else if (intent === "dismiss") await dismissGuidance.call({ flowKey }, actor);
  else if (intent === "reset") await resetGuidance.call({ flowKey }, actor);
  else throw new ServiceError("validation", "Choose a guidance action.");
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/privacy");
  redirect(returnTo);
}

export async function portalSignOutAction(): Promise<void> {
  const [locale, business] = await Promise.all([getLocale(), currentBusiness()]);
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await logout
      .call({ token }, await currentPortalActor())
      .catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
  redirect(
    business
      ? localizeCustomerHref("/portal/login", locale, business)
      : "/portal/login",
  );
}
