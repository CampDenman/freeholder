// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";

/** Setup retains its narrow owner services; this only orders browser steps. */
export async function setupOwner(requireSecurity = true) {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user" || actor.role !== "owner") redirect("/login");
  if (requireSecurity && !actor.security?.twoFactorEnrolled) redirect("/setup/security");
  if (requireSecurity && !actor.security?.twoFactorVerified) redirect("/security/verify?returnTo=/setup/business");
  return actor;
}
