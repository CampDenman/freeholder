// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  CUSTOMER_MAGIC_COOKIE,
  consumeCustomerMagicLink,
  requestCustomerMagicLink,
} from "@/core/auth/magic-links/service";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { CSRF_COOKIE, issueCsrfToken } from "@/core/http/csrf";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";

export interface MagicLinkState {
  sent?: boolean;
  error?: string;
}

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
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
