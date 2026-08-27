// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { GALLERY_SESSION_COOKIE } from "@/modules/galleries/cookies";
import {
  openGalleryWithLogin,
  redeemGalleryGuest,
  unlockGallery,
} from "@/modules/galleries/service";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function remember(token: string): Promise<void> {
  (await cookies()).set(GALLERY_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // The cookie is the gallery. Handing it to a plaintext hop is the one
    // way a PIN-gated delivery leaks without anybody guessing the PIN.
    secure: process.env.NODE_ENV === "production",
    path: "/g",
    maxAge: 7 * 24 * 60 * 60,
  });
}

/** `redirect()` reports itself by throwing; a catch that eats it is a bug. */
function isRedirect(error: unknown): boolean {
  return typeof error === "object" && error !== null && "digest" in error;
}

function messageFor(error: unknown): string {
  return error instanceof ServiceError
    ? error.message
    : "That did not work. Nothing has changed.";
}

/**
 * The three doors differ only in what they hand the service. Each one either
 * remembers a session and shows the gallery, or says no and shows the lock
 * screen again — and `redirect()` is called once, outside the try, so a
 * successful open is never mistaken for a failure.
 */
async function open(
  slug: string,
  attempt: () => Promise<{ ok: true; sessionToken: string } | { ok: false }>,
): Promise<void> {
  let failure: string | null = null;
  try {
    const opened = await attempt();
    if (opened.ok) await remember(opened.sessionToken);
    else failure = "That did not work. Nothing has changed.";
  } catch (error) {
    if (isRedirect(error)) throw error;
    failure = messageFor(error);
  }
  if (failure) redirect(`/g/${slug}?error=${encodeURIComponent(failure)}`);
  redirect(`/g/${slug}`);
}

export async function unlockGalleryAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  await open(slug, () =>
    unlockGallery.call({ slug, secret: text(form, "secret") }, { kind: "anonymous" }),
  );
}

export async function redeemGalleryGuestAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  await open(slug, () =>
    redeemGalleryGuest.call({ token: text(form, "token") }, { kind: "anonymous" }),
  );
}

export async function openGalleryWithLoginAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  await open(slug, async () =>
    openGalleryWithLogin.call(
      { slug },
      await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value),
    ),
  );
}
