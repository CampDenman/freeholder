// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Cookie names for private client galleries (C8.03).
//
// These live outside the server-action files that set them because a
// `"use server"` module may export nothing but async functions: a plain
// constant there is a build error, not a lint opinion. `SITE_CHAT_COOKIE`
// is kept apart for the same reason.

/** The client's gallery session. One cookie, one gallery, seven days. */
export const GALLERY_SESSION_COOKIE = "fh_gallery_session";

/**
 * A guest magic link, handed back to the owner once. Only the token's hash
 * is stored, so the invite response is the last place the raw link exists.
 */
export const GALLERY_INVITE_COOKIE = "fh_gallery_invite";
