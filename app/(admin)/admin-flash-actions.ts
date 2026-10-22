// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Hands the admin shell the refusal a server action recorded, once.
import { cookies } from "next/headers";
import { ADMIN_ERROR_COOKIE, decodeAdminError } from "./action-helpers";

/**
 * The sentence the last refused admin action flashed, or null. Read and
 * cleared in one step, so a refresh does not show it again. Only this
 * browser's own httpOnly cookie is read — nothing from the URL.
 */
export async function takeAdminError(): Promise<string | null> {
  const jar = await cookies();
  const message = decodeAdminError(jar.get(ADMIN_ERROR_COOKIE)?.value);
  if (message) jar.delete({ name: ADMIN_ERROR_COOKIE, path: "/admin" });
  return message;
}
