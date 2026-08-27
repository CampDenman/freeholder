// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for private client galleries (C8.03).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  addGalleryItem,
  createGallery,
  inviteGalleryGuest,
  removeGalleryItem,
  revokeGalleryGuest,
  updateGallery,
} from "@/modules/galleries/service";
import { ownerFacing } from "./action-helpers";

const GALLERIES = "/admin/galleries";

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

export async function createGalleryAction(form: FormData): Promise<void> {
  let created: string;
  try {
    const gallery = await createGallery.call(
      {
        title: text(form, "title"),
        contactId: text(form, "contactId"),
        access: text(form, "access") as "pin" | "password" | "login",
        secret: text(form, "secret") || undefined,
      },
      await actor(),
    );
    created = gallery.id;
  } catch (error) {
    refused(error, GALLERIES, "That gallery could not be started.");
  }
  revalidatePath(GALLERIES);
  redirect(`${GALLERIES}/${created}`);
}

export async function updateGalleryAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const path = `${GALLERIES}/${id}`;
  try {
    const downloadPolicy = text(form, "downloadPolicy") as
      | "none"
      | "web_res"
      | "full_res"
      | "limit_n";
    await updateGallery.call(
      {
        id,
        title: text(form, "title") || undefined,
        access: text(form, "access") as "pin" | "password" | "login" | "",
        secret: text(form, "secret") || undefined,
        expiresAt: text(form, "expiresAt")
          ? new Date(text(form, "expiresAt")).toISOString()
          : null,
        downloadPolicy: downloadPolicy || undefined,
        downloadLimit: text(form, "downloadLimit") ? Number(text(form, "downloadLimit")) : undefined,
        watermark: form.get("watermark") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That gallery could not be saved.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function addGalleryItemAction(form: FormData): Promise<void> {
  const galleryId = text(form, "galleryId");
  const path = `${GALLERIES}/${galleryId}`;
  try {
    await addGalleryItem.call(
      {
        galleryId,
        assetId: text(form, "assetId"),
        canDownload: form.get("canDownload") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That file could not be added.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function removeGalleryItemAction(form: FormData): Promise<void> {
  const galleryId = text(form, "galleryId");
  const path = `${GALLERIES}/${galleryId}`;
  try {
    await removeGalleryItem.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, path, "That file could not be removed.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function inviteGalleryGuestAction(form: FormData): Promise<void> {
  const galleryId = text(form, "galleryId");
  const path = `${GALLERIES}/${galleryId}`;
  try {
    await inviteGalleryGuest.call(
      {
        galleryId,
        email: text(form, "email"),
        name: text(form, "name") || undefined,
        role: (text(form, "role") || "partner") as "client" | "partner",
        canDownload: form.get("canDownload") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That guest could not be invited.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function revokeGalleryGuestAction(form: FormData): Promise<void> {
  const galleryId = text(form, "galleryId");
  const path = `${GALLERIES}/${galleryId}`;
  try {
    await revokeGalleryGuest.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, path, "That guest could not be revoked.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}
