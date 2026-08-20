// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { ownerFacing } from "./action-helpers";
import {
  commitImport,
  previewImport,
  publishImport,
  reconcileImport,
  rollbackImport,
  startImport,
} from "@/core/import/service";

export interface ImportActionState {
  error?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function startImportAction(
  _prev: ImportActionState,
  form: FormData,
): Promise<ImportActionState> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    const started = await startImport.call(
      {
        origin: text(form, "origin"),
        kind: text(form, "kind") as
          | "wordpress-rest"
          | "wordpress-wxr"
          | "sitemap"
          | "rss"
          | "atom"
          | "html"
          | "archive",
      },
      actor,
    );
    revalidatePath("/admin/imports");
    redirect(`/admin/imports/${started.id}`);
  } catch (error) {
    return {
      error: error instanceof ServiceError ? ownerFacing(error.message) : "That import could not start.",
    };
  }
}

export async function previewImportAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const id = text(form, "id");
  await previewImport.call(
    {
      id,
      pages: [{ url: text(form, "url"), slug: text(form, "slug"), title: text(form, "title") }],
    },
    actor,
  );
  revalidatePath(`/admin/imports/${id}`);
}

export async function commitImportAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const id = text(form, "id");
  await commitImport.call({ id }, actor);
  revalidatePath(`/admin/imports/${id}`);
}

export async function reconcileImportAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const id = text(form, "id");
  await reconcileImport.call({ id, counts: { pages: 1, media: 0, redirects: 0 } }, actor);
  revalidatePath(`/admin/imports/${id}`);
}

export async function publishImportAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const id = text(form, "id");
  await publishImport.call({ id }, actor);
  revalidatePath(`/admin/imports/${id}`);
}

export async function rollbackImportAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const id = text(form, "id");
  await rollbackImport.call({ id }, actor);
  revalidatePath(`/admin/imports/${id}`);
}
