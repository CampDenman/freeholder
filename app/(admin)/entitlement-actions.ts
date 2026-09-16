// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  grantAccess,
  revokeGrant,
  saveEntitlement,
} from "@/core/entitlements/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function done(error?: unknown, flag = "saved"): never {
  if (error instanceof ServiceError) {
    redirect(`/admin/access?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("entitlement action failed");
  redirect(`/admin/access?${flag}=1`);
}

export async function saveEntitlementAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  const selector = text(form, "selector");
  try {
    await saveEntitlement.call(
      {
        ...(id ? { id } : {}),
        grantorType: (text(form, "grantorType") || "manual") as
          | "plan"
          | "pass"
          | "unlock"
          | "tier"
          | "manual",
        grantorId: text(form, "grantorId"),
        name: text(form, "name"),
        resource: {
          kind: text(form, "kind") || "site",
          ...(selector ? { selector } : {}),
        },
        status: (text(form, "status") || "active") as "active" | "archived",
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  done();
}

export async function grantAccessAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await grantAccess.call(
      {
        contactId: text(form, "contactId"),
        entitlementId: text(form, "entitlementId") || undefined,
        name: text(form, "name") || undefined,
        grantorType: "manual",
        resource: text(form, "kind")
          ? { kind: text(form, "kind"), ...(text(form, "selector") ? { selector: text(form, "selector") } : {}) }
          : undefined,
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  done(undefined, "granted");
}

export async function revokeGrantAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await revokeGrant.call({ id: text(form, "id") }, caller);
  } catch (error) {
    done(error);
  }
  done(undefined, "revoked");
}
