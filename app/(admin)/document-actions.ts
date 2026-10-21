// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The admin's document shelf. Thin, like every other caller (§11).
//
// The one thing this file does beyond forwarding: it carries the share token
// back to the screen exactly once, in the redirect. §4.5 stores only the HMAC,
// so there is no service that can read a token back — if the owner does not
// copy it now, the only remedy is a new share. That is the correct trade and
// it has to be visible in the UI rather than discovered.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  addVersion,
  revokeShare,
  saveDocument,
  share,
} from "@/modules/documents/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value.length > 0 ? value : null;
}

function fail(path: string, error: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`${path}?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  throw new Error("document action failed");
}

export async function createDocumentAction(form: FormData): Promise<void> {
  const caller = await actor();
  let created: { id: string };
  try {
    created = await saveDocument.call(
      {
        title: text(form, "title"),
        description: optional(form, "description"),
        contactId: optional(form, "contactId"),
      },
      caller,
    );
  } catch (error) {
    fail("/admin/documents", error);
  }
  revalidatePath("/admin/documents");
  redirect(`/admin/documents/${created.id}`);
}

export async function saveDocumentAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await saveDocument.call(
      {
        id,
        title: text(form, "title"),
        description: optional(form, "description"),
        contactId: optional(form, "contactId"),
        status: (text(form, "status") || "draft") as "draft" | "shared" | "archived",
      },
      caller,
    );
  } catch (error) {
    fail(`/admin/documents/${id}`, error);
  }
  revalidatePath(`/admin/documents/${id}`);
  redirect(`/admin/documents/${id}?saved=1`);
}

export async function addVersionAction(form: FormData): Promise<void> {
  const caller = await actor();
  const documentId = text(form, "documentId");
  try {
    await addVersion.call(
      {
        documentId,
        assetId: text(form, "assetId"),
        note: optional(form, "note"),
      },
      caller,
    );
  } catch (error) {
    fail(`/admin/documents/${documentId}`, error);
  }
  revalidatePath(`/admin/documents/${documentId}`);
  redirect(`/admin/documents/${documentId}?saved=1`);
}

export async function shareDocumentAction(form: FormData): Promise<void> {
  const caller = await actor();
  const documentId = text(form, "documentId");
  const expiresRaw = text(form, "expiresAt");
  const limitRaw = text(form, "downloadLimit");
  let created: { shareId: string; token: string | null };
  try {
    created = await share.call(
      {
        documentId,
        access: (text(form, "access") || "link") as "link" | "password" | "login",
        contactId: optional(form, "contactId"),
        password: optional(form, "password") ?? undefined,
        pinnedVersionId: optional(form, "pinnedVersionId"),
        downloadPolicy: (text(form, "downloadPolicy") || "download") as
          | "none"
          | "view"
          | "download",
        downloadLimit: limitRaw ? Number.parseInt(limitRaw, 10) : null,
        // A date input gives a day, not an instant. End of that day in the
        // server's zone is the reading that matches what an owner means by
        // "expires on the 4th" — the 4th is still a day they can open it.
        expiresAt: expiresRaw ? new Date(`${expiresRaw}T23:59:59`) : null,
      },
      caller,
    );
  } catch (error) {
    fail(`/admin/documents/${documentId}`, error);
  }
  revalidatePath(`/admin/documents/${documentId}`);
  // Shown once. There is no service that can read it back.
  redirect(
    created.token
      ? `/admin/documents/${documentId}?token=${encodeURIComponent(created.token)}`
      : `/admin/documents/${documentId}?saved=1`,
  );
}

export async function revokeShareAction(form: FormData): Promise<void> {
  const caller = await actor();
  const documentId = text(form, "documentId");
  try {
    await revokeShare.call({ shareId: text(form, "shareId") }, caller);
  } catch (error) {
    fail(`/admin/documents/${documentId}`, error);
  }
  revalidatePath(`/admin/documents/${documentId}`);
  redirect(`/admin/documents/${documentId}?saved=1`);
}
