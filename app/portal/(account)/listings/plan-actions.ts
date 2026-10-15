// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.05: a member's subscription plans.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { createMemberPlan, setMemberPlanStatus } from "@/modules/members/member-subscriptions";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function planAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    if (text(form, "verb") === "create") {
      await createMemberPlan.call({ name: text(form, "name"), description: text(form, "description"), price: text(form, "price"), interval: text(form, "interval") === "year" ? "year" : "month" }, actor);
    } else {
      await setMemberPlanStatus.call({ planId: text(form, "planId"), offered: text(form, "verb") === "offer" }, actor);
    }
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/portal/listings?error=${error.code}`);
    throw error;
  }
  redirect("/portal/listings?saved=1");
}
