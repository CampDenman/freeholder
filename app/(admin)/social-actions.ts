// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  assignProfile,
  beginOAuth,
  checkHealth,
  disconnectProfile,
  draftFromPackage,
  ingestProfile,
  reviewProfile,
  setPolicy,
} from "@/modules/social/service";
import { ownerFacing } from "./action-helpers";

const SOCIAL = "/admin/social";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function done(error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`${SOCIAL}?error=${encodeURIComponent(ownerFacing(error.message))}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("social action failed");
  redirect(`${SOCIAL}?saved=1`);
}

export async function beginSocialOAuthAction(form: FormData): Promise<void> {
  let authorizationUrl: string;
  try {
    const begun = await beginOAuth.call(
      { provider: text(form, "provider"), returnTo: SOCIAL },
      await actor(),
    );
    authorizationUrl = begun.authorizationUrl;
  } catch (error) {
    done(error);
  }
  redirect(authorizationUrl);
}

export async function reviewSocialAction(form: FormData): Promise<void> {
  try {
    await reviewProfile.call(
      { id: text(form, "id"), approved: text(form, "approved") === "1" },
      await actor(),
    );
  } catch (error) {
    done(error);
  }
  revalidatePath(SOCIAL);
  done();
}

export async function assignSocialAction(form: FormData): Promise<void> {
  const assignedTo = text(form, "assignedTo");
  const locationIds = form
    .getAll("locationIds")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  try {
    await assignProfile.call(
      {
        id: text(form, "id"),
        assignedTo:
          assignedTo === "user" || assignedTo === "locations" ? assignedTo : "business",
        assigneeUserId: text(form, "assigneeUserId") || null,
        locationIds,
      },
      await actor(),
    );
  } catch (error) {
    done(error);
  }
  revalidatePath(SOCIAL);
  done();
}

export async function setSocialPolicyAction(form: FormData): Promise<void> {
  try {
    await setPolicy.call(
      {
        id: text(form, "id"),
        allowRead: form.get("allowRead") === "1",
        allowRespond: form.get("allowRespond") === "1",
        allowPublish: form.get("allowPublish") === "1",
        approvalPolicy: text(form, "approvalPolicy") === "none" ? "none" : "required",
      },
      await actor(),
    );
  } catch (error) {
    done(error);
  }
  revalidatePath(SOCIAL);
  done();
}

export async function healthSocialAction(form: FormData): Promise<void> {
  try {
    await checkHealth.call({ id: text(form, "id") || undefined }, await actor());
  } catch (error) {
    done(error);
  }
  revalidatePath(SOCIAL);
  done();
}

export async function ingestSocialAction(form: FormData): Promise<void> {
  try {
    await ingestProfile.call({ profileId: text(form, "id") }, await actor());
  } catch (error) {
    done(error);
  }
  revalidatePath(SOCIAL);
  done();
}

export async function draftSocialAction(form: FormData): Promise<void> {
  try {
    await draftFromPackage.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    done(error);
  }
  revalidatePath(SOCIAL);
  done();
}

export async function disconnectSocialAction(form: FormData): Promise<void> {
  try {
    await disconnectProfile.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    done(error);
  }
  revalidatePath(SOCIAL);
  done();
}
