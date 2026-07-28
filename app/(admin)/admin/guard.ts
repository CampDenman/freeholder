// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// The admin auth gate.
//
// Deliberately callable from every admin page, not just the layout: Next
// renders layouts and their pages *in parallel*, so a redirect in the layout
// does not stop the page body from executing. A page that assumed the layout
// had already vetted the caller would run its service calls as anonymous and
// throw a permission error before the redirect landed — a 500 where the
// visitor should have seen a sign-in form.
//
// So the rule is: every admin page resolves its own actor through this, and
// uses the actor it returns rather than resolving one itself.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { setupState } from "@/core/settings/service";
import type { Actor } from "@/core/service";

const ANONYMOUS = { kind: "anonymous" } as const;

/** The signed-in owner or staff member, or a redirect away from here. */
export async function requireStaffActor(): Promise<Actor> {
  const state = await setupState.call({}, ANONYMOUS);
  if (!state.hasOwner) redirect("/setup");

  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  // Customers have accounts too (§4.1) and the portal is theirs; the admin is
  // not. Anyone who is not staff or better goes to sign in.
  if (actor.kind !== "user" || actor.role === "customer") redirect("/login");
  return actor;
}
