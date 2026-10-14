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
import { reviewListing } from "@/modules/members/listings";
import { setPayoutAccountStatus, settlePayouts } from "@/modules/members/payouts";

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

export async function saveMarketRulesAction(form: FormData): Promise<void> {
  const model = text(form, "payoutModel");
  await run(async () =>
    updateMembershipRules.call(
      {
        marketplaceEnabled: form.get("marketplaceEnabled") === "yes",
        listingReview: form.get("listingReview") === "yes",
        payoutModel: model === "seller_merchant" || model === "instant" ? model : "hold",
        holdDays: Number(text(form, "holdDays")) || 14,
        siteFeeBps: Math.round(Number(text(form, "siteFeePercent") || "0") * 100),
        payoutAdapter: text(form, "payoutAdapter") || "manual",
      },
      await actor(),
    ),
  );
}

export async function payoutAccountAction(form: FormData): Promise<void> {
  const status = text(form, "status");
  await run(async () =>
    setPayoutAccountStatus.call(
      { userId: text(form, "userId"), status: status === "disabled" ? "disabled" : status === "pending" ? "pending" : "ready" },
      await actor(),
    ),
  );
}

export async function settlePayoutsAction(form: FormData): Promise<void> {
  const action = text(form, "action");
  const ids = form.getAll("ids").filter((v): v is string => typeof v === "string");
  await run(async () =>
    settlePayouts.call(
      {
        ids,
        action: action === "paid" || action === "cancel" || action === "owe" ? action : "release",
        reference: text(form, "reference") || undefined,
        note: text(form, "note") || undefined,
      },
      await actor(),
    ),
  );
}

export async function reviewListingAction(form: FormData): Promise<void> {
  await run(async () =>
    reviewListing.call(
      { productId: text(form, "productId"), approve: text(form, "decision") === "approve", note: text(form, "note") || undefined },
      await actor(),
    ),
  );
}
