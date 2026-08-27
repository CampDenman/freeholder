// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  openGalleryWithLogin,
  redeemGalleryGuest,
  unlockGallery,
} from "@/modules/galleries/service";

export const GALLERY_SESSION_COOKIE = "fh_gallery_session";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function remember(token: string, slug: string): Promise<void> {
  (await cookies()).set(GALLERY_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/g",
    maxAge: 7 * 24 * 60 * 60,
  });
  redirect(`/g/${slug}`);
}

function refused(slug: string, error: unknown): never {
  const message =
    error instanceof ServiceError ? error.message : "That did not work. Nothing has changed.";
  redirect(`/g/${slug}?error=${encodeURIComponent(message)}`);
}

export async function unlockGalleryAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  try {
    const opened = await unlockGallery.call(
      { slug, secret: text(form, "secret") },
      { kind: "anonymous" },
    );
    if (!opened.ok) refused(slug, new ServiceError("permission", "That did not work. Nothing has changed."));
    await remember(opened.sessionToken, slug);
  } catch (error) {
    refused(slug, error);
  }
}

export async function redeemGalleryGuestAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  try {
    const opened = await redeemGalleryGuest.call(
      { token: text(form, "token") },
      { kind: "anonymous" },
    );
    if (!opened.ok) refused(slug, new ServiceError("permission", "That did not work. Nothing has changed."));
    await remember(opened.sessionToken, slug);
  } catch (error) {
    refused(slug, error);
  }
}

export async function openGalleryWithLoginAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  try {
    const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
    const opened = await openGalleryWithLogin.call({ slug }, actor);
    if (!opened.ok) refused(slug, new ServiceError("permission", "That did not work. Nothing has changed."));
    await remember(opened.sessionToken, slug);
  } catch (error) {
    refused(slug, error);
  }
}
