// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the redirect list (C11.09 F04). Chain following and the
// self-redirect refusal live in `seo.recordRedirect`, not in this form.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { deleteRedirect, recordRedirect } from "@/core/seo/service";
import { ownerFacing } from "./action-helpers";

const REDIRECTS = "/admin/redirects";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${REDIRECTS}?error=${encodeURIComponent(message)}`);
}

export async function recordRedirectAction(form: FormData): Promise<void> {
  const status = text(form, "status");
  try {
    await recordRedirect.call(
      {
        fromPath: text(form, "fromPath"),
        toPath: text(form, "toPath"),
        status: status === "302" ? "302" : "301",
        source: "manual",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That redirect could not be saved.");
  }
  revalidatePath(REDIRECTS);
  redirect(`${REDIRECTS}?saved=recorded`);
}

export async function deleteRedirectAction(form: FormData): Promise<void> {
  if (text(form, "confirm") !== "yes") {
    refused(new ServiceError("validation", "Confirm that this redirect should stop."), "Confirm that this redirect should stop.");
  }
  try {
    await deleteRedirect.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That redirect could not be deleted.");
  }
  revalidatePath(REDIRECTS);
  redirect(`${REDIRECTS}?saved=deleted`);
}
