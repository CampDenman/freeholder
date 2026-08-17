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
  createIssue,
  createNewsletter,
  publishIssue,
} from "@/modules/newsletters/service";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const resolved = token ? await actorFromToken(token) : null;
  if (!resolved) throw new ServiceError("permission", "Sign in to continue.");
  return resolved;
}

function fail(path: string, error: unknown): never {
  const message = error instanceof ServiceError ? error.message : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function newsletterAction(form: FormData): Promise<void> {
  const intent = field(form, "intent");
  const signed = await actor();
  try {
    if (intent === "create") {
      const created = await createNewsletter.call(
        {
          name: field(form, "name"),
          slug: field(form, "slug"),
          description: field(form, "description") || undefined,
        },
        signed,
      );
      revalidatePath("/admin/newsletters");
      redirect(`/admin/newsletters/${created.id}`);
    }
    if (intent === "issue") {
      const newsletterId = field(form, "newsletterId");
      const created = await createIssue.call(
        {
          newsletterId,
          slug: field(form, "slug"),
          title: field(form, "title"),
          excerpt: field(form, "excerpt") || undefined,
          body: field(form, "body"),
        },
        signed,
      );
      revalidatePath(`/admin/newsletters/${newsletterId}`);
      redirect(`/admin/newsletters/${newsletterId}?saved=${created.id}`);
    }
    if (intent === "publish") {
      const newsletterId = field(form, "newsletterId");
      await publishIssue.call(
        {
          id: field(form, "id"),
          expectedVersion: Number(field(form, "expectedVersion") || 0),
        },
        signed,
      );
      revalidatePath(`/admin/newsletters/${newsletterId}`);
      revalidatePath("/admin/newsletters");
    }
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    fail("/admin/newsletters", error);
  }
}
