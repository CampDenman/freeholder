// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
import { hasModuleAccess, type Actor, type GrantAccess } from "@/core/service";

const ANONYMOUS = { kind: "anonymous" } as const;

/** A signed-in person granted the admin shell and, optionally, one module. */
export async function requireStaffActor(
  module?: string,
  access: GrantAccess = "view",
): Promise<Actor> {
  const state = await setupState.call({}, ANONYMOUS);
  if (!state.hasOwner) redirect("/setup");

  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (actor.kind === "user" && actor.security?.twoFactorRequired) {
    if (!actor.security.twoFactorEnrolled) redirect("/security?required=1");
    if (!actor.security.twoFactorVerified) {
      redirect("/security/verify?returnTo=/admin");
    }
  }
  // A role name is display data, not authority. The customer default has no
  // admin grant, while an owner-defined role may enter when its stored grants
  // say so.
  if (actor.kind !== "user" || !hasModuleAccess(actor, "admin")) {
    redirect("/login");
  }
  if (module && !hasModuleAccess(actor, module, access)) {
    redirect(`/admin?denied=${encodeURIComponent(module)}`);
  }
  return actor;
}

/** The one bootstrap owner, used by screens whose authority is intentionally not delegable. */
export async function requireOwnerActor(module?: string): Promise<Extract<Actor, { kind: "user" }>> {
  const actor = await requireStaffActor(module);
  if (actor.kind !== "user" || actor.role !== "owner") {
    redirect(`/admin?denied=${encodeURIComponent(module ?? "owner")}`);
  }
  return actor;
}
