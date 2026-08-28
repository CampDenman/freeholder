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
  clearGallerySelection,
  openGalleryWithLogin,
  redeemGalleryGuest,
  requestGalleryArchive,
  setGallerySelection,
  submitGalleryRound,
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

/**
 * Proofing from the client surface (C8.05).
 *
 * The session cookie carries who is speaking, so a magic-link guest can proof
 * from a phone without an account. Redirecting back to the gallery rather than
 * returning JSON keeps the whole flow working without JavaScript.
 */
async function proof(
  slug: string,
  attempt: () => Promise<unknown>,
): Promise<void> {
  let failure: string | null = null;
  try {
    const token = (await cookies()).get(GALLERY_SESSION_COOKIE)?.value;
    if (!token) failure = "That did not work. Nothing has changed.";
    else await attempt();
  } catch (error) {
    if (isRedirect(error)) throw error;
    failure = messageFor(error);
  }
  if (failure) redirect(`/g/${slug}?error=${encodeURIComponent(failure)}`);
  redirect(`/g/${slug}`);
}

export async function setGallerySelectionAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  await proof(slug, async () => {
    const token = (await cookies()).get(GALLERY_SESSION_COOKIE)?.value ?? "";
    const comment = text(form, "comment");
    return setGallerySelection.call(
      {
        sessionToken: token,
        itemId: text(form, "itemId"),
        kind: text(form, "kind") as "favorite" | "select" | "reject",
        comment: comment || null,
      },
      { kind: "anonymous" },
    );
  });
}

export async function clearGallerySelectionAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  await proof(slug, async () => {
    const token = (await cookies()).get(GALLERY_SESSION_COOKIE)?.value ?? "";
    return clearGallerySelection.call(
      { sessionToken: token, itemId: text(form, "itemId") },
      { kind: "anonymous" },
    );
  });
}

/** The client sends their choices to the owner (C8.06). */
export async function submitGalleryRoundAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  await proof(slug, async () => {
    const token = (await cookies()).get(GALLERY_SESSION_COOKIE)?.value ?? "";
    return submitGalleryRound.call({ sessionToken: token }, { kind: "anonymous" });
  });
}

/** The client asks for the whole gallery as one download (C8.07). */
export async function requestGalleryArchiveAction(form: FormData): Promise<void> {
  const slug = text(form, "slug");
  await proof(slug, async () => {
    const token = (await cookies()).get(GALLERY_SESSION_COOKIE)?.value ?? "";
    return requestGalleryArchive.call({ sessionToken: token }, { kind: "anonymous" });
  });
}
