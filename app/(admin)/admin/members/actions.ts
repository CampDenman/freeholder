// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.01: the site admin's membership controls.
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { inviteMember, setMemberStatus, updateMembershipRules } from "@/modules/members/service";

const PATH = "/admin/members";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function run(work: () => Promise<unknown>, back = PATH): Promise<never> {
  try {
    await work();
  } catch (error) {
    if (error instanceof ServiceError) {
      redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
  revalidatePath(PATH);
  redirect(`${back}${back.includes("?") ? "&" : "?"}saved=1`);
}

export async function saveMembershipRulesAction(form: FormData): Promise<void> {
  const policy = text(form, "joinPolicy");
  await run(async () =>
    updateMembershipRules.call(
      {
        joinPolicy: policy === "approval" || policy === "invite" ? policy : "open",
        minimumAge: Number(text(form, "minimumAge")),
      },
      await actor(),
    ),
  );
}

export async function inviteMemberAction(form: FormData): Promise<void> {
  await run(async () => inviteMember.call({ email: text(form, "email") }, await actor()));
}

export async function setMemberStatusAction(form: FormData): Promise<void> {
  const status = text(form, "status");
  const back = text(form, "back") || PATH;
  await run(
    async () =>
      setMemberStatus.call(
        {
          userId: text(form, "userId"),
          status: status === "suspended" || status === "pending" ? status : "active",
          reason: text(form, "reason") || undefined,
        },
        await actor(),
      ),
    back.startsWith("/admin/members") ? back : PATH,
  );
}
