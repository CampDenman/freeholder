// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.09: a seller tells the site how to pay them.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { savePayoutInstructions } from "@/modules/members/payouts";

export async function savePayoutInstructionsAction(form: FormData): Promise<void> {
  const value = form.get("instructions");
  try {
    await savePayoutInstructions.call(
      { instructions: typeof value === "string" ? value : "" },
      await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value),
    );
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/portal/payouts?error=${error.code}`);
    throw error;
  }
  redirect("/portal/payouts?saved=1");
}
