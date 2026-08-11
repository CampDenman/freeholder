// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
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
import { getT } from "../i18n";

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
    await requestCustomerMagicLink.call(
      { email: field(form, "email") },
      {
        kind: "anonymous",
        request: requestMetadataFromHeaders(await headers()),
      },
    );
  } catch (error) {
    if (error instanceof ServiceError && error.code === "rate_limited") {
      return { error: error.message };
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
  if (!token) return { error: "That sign-in link is no longer available. Ask for a new one." };
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
          ? error.message
          : "That sign-in link could not be used. Ask for a new one.",
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
    path: "/portal/magic",
    secure,
    maxAge: 0,
  });
  redirect("/portal/login");
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
    return {
      error:
        error instanceof ServiceError
          ? error.message
          : "Something went wrong. Try again.",
    };
  }
  revalidatePath("/portal/privacy");
  const t = await getT();
  return { saved: true, message: t(messageKey) };
}

export async function portalSignOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await logout
      .call({ token }, await currentPortalActor())
      .catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
  redirect("/portal/login");
}
