// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the contact import (C7.07). The parser, the dry run, the
// spine resolution and the reversal rules all live in `core/import`, so an
// import run from this screen and one driven over the API do the same thing and
// leave the same ledger behind.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  beginContactImport,
  commitContactImport,
  IMPORTABLE_FIELDS,
  mapContactImport,
  revertContactImport,
} from "@/core/import/contacts-service";
import { ownerFacing } from "./action-helpers";

const IMPORTS = "/admin/imports/contacts";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * The file, as text.
 *
 * Read here rather than stored as an asset: a contact list is somebody's
 * personal data and the platform should hold the *rows*, which it can show,
 * check and reverse — not a copy of the original file sitting in object storage
 * for nobody to notice.
 */
export async function beginContactImportAction(form: FormData): Promise<void> {
  const file = form.get("file");
  try {
    if (!(file instanceof File) || file.size === 0) {
      throw new ServiceError("validation", "Choose a CSV file to import.");
    }
    const started = await beginContactImport.call(
      {
        filename: file.name,
        csv: await file.text(),
        source: text(form, "source") || "import",
      },
      await actor(),
    );
    revalidatePath(IMPORTS);
    redirect(`${IMPORTS}/${started.id}`);
  } catch (error) {
    // `redirect` throws to unwind; letting it through is how the navigation
    // actually happens.
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    if (typeof error === "object" && error !== null && "digest" in error) throw error;
    refused(error, IMPORTS, "That file could not be read.");
  }
}

export async function mapContactImportAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const path = `${IMPORTS}/${id}`;
  try {
    const mapping = form
      .getAll("mapping")
      .filter((value): value is string => typeof value === "string")
      .map((value) =>
        (IMPORTABLE_FIELDS as readonly string[]).includes(value) ? value : "ignore",
      ) as Array<(typeof IMPORTABLE_FIELDS)[number]>;
    await mapContactImport.call(
      { id, mapping, source: text(form, "source") || undefined },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "Those columns could not be set.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=mapped`);
}

export async function commitContactImportAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const path = `${IMPORTS}/${id}`;
  try {
    await commitContactImport.call({ id }, await actor());
  } catch (error) {
    refused(error, path, "That import could not be applied.");
  }
  revalidatePath(path);
  revalidatePath("/admin/contacts");
  redirect(`${path}?saved=committed`);
}

export async function revertContactImportAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const path = `${IMPORTS}/${id}`;
  try {
    await revertContactImport.call({ id }, await actor());
  } catch (error) {
    refused(error, path, "That import could not be undone.");
  }
  revalidatePath(path);
  revalidatePath("/admin/contacts");
  redirect(`${path}?saved=reverted`);
}
