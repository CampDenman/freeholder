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
  appendCaptureChunk,
  assembleCapture,
  attachCaptureUpload,
  bindCaptureAsset,
  confirmCapture,
  createCaptureSession,
  createUploadLink,
  discardCapture,
  grantCapturePermission,
  reviewCapture,
  startCapture,
  stopCapture,
} from "@/core/media/capture";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function startRecordingAction(form: FormData): Promise<void> {
  const source = field(form, "source");
  if (source !== "camera" && source !== "microphone" && source !== "screen") {
    redirect("/admin/media/record?error=source");
  }
  const session = await createCaptureSession.call({ source }, await actor());
  revalidatePath("/admin/media/record");
  redirect(`/admin/media/record?session=${session.id}`);
}

export async function createPhoneLinkAction(): Promise<void> {
  const link = await createUploadLink.call({ source: "upload_link" }, await actor());
  revalidatePath("/admin/media/record");
  redirect(`/admin/media/record?link=${link.id}`);
}

export async function grantCaptureAction(form: FormData): Promise<void> {
  await grantCapturePermission.call(
    {
      id: field(form, "id"),
      displaySurface: (["monitor", "window", "browser"] as const).find(
        (value) => value === field(form, "displaySurface"),
      ),
    },
    await actor(),
  );
}

export async function markLiveAction(form: FormData): Promise<void> {
  await startCapture.call({ id: field(form, "id") }, await actor());
}

export async function markStoppedAction(form: FormData): Promise<void> {
  await stopCapture.call({ id: field(form, "id") }, await actor());
}

export async function appendChunkAction(form: FormData): Promise<void> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await appendCaptureChunk.call(
    {
      id: field(form, "id") || undefined,
      token: field(form, "token") || undefined,
      sequence: Number(field(form, "sequence") || 0),
      contentType: file.type || "video/webm",
      bytes,
    },
    (await actor()) ?? { kind: "anonymous" },
  );
}

export async function assembleCaptureAction(form: FormData): Promise<void> {
  await assembleCapture.call(
    {
      id: field(form, "id") || undefined,
      token: field(form, "token") || undefined,
      filename: field(form, "filename") || "capture.webm",
    },
    (await actor()) ?? { kind: "anonymous" },
  );
  revalidatePath("/admin/media/record");
}

export async function bindCaptureAction(form: FormData): Promise<void> {
  await bindCaptureAsset.call(
    {
      id: field(form, "id") || undefined,
      token: field(form, "token") || undefined,
      assetId: field(form, "assetId"),
    },
    (await actor()) ?? { kind: "anonymous" },
  );
  revalidatePath("/admin/media/record");
}

export async function attachCaptureAction(form: FormData): Promise<void> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new ServiceError("validation", "Choose a recording or photo to attach.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = field(form, "id") || undefined;
  const token = field(form, "token") || undefined;
  await attachCaptureUpload.call(
    {
      id,
      token,
      filename: file.name || "capture.webm",
      contentType: file.type || "video/webm",
      bytes,
    },
    (await actor()) ?? { kind: "anonymous" },
  );
  revalidatePath("/admin/media/record");
  if (token) revalidatePath(`/capture/${token}`);
}

export async function reviewCaptureAction(form: FormData): Promise<void> {
  await reviewCapture.call(
    {
      id: field(form, "id"),
      trimStartMs: field(form, "trimStartMs") ? Number(field(form, "trimStartMs")) : undefined,
      trimEndMs: field(form, "trimEndMs") ? Number(field(form, "trimEndMs")) : undefined,
      caption: field(form, "caption") || null,
      focalX: field(form, "focalX") ? Number(field(form, "focalX")) : undefined,
      focalY: field(form, "focalY") ? Number(field(form, "focalY")) : undefined,
    },
    await actor(),
  );
  revalidatePath("/admin/media/record");
}

export async function confirmCaptureAction(form: FormData): Promise<void> {
  const id = field(form, "id");
  if (id && (field(form, "caption") || field(form, "trimStartMs") || field(form, "focalX"))) {
    await reviewCapture.call(
      {
        id,
        trimStartMs: field(form, "trimStartMs") ? Number(field(form, "trimStartMs")) : undefined,
        trimEndMs: field(form, "trimEndMs") ? Number(field(form, "trimEndMs")) : undefined,
        caption: field(form, "caption") || null,
        focalX: field(form, "focalX") ? Number(field(form, "focalX")) : undefined,
        focalY: field(form, "focalY") ? Number(field(form, "focalY")) : undefined,
      },
      await actor(),
    );
  }
  await confirmCapture.call(
    {
      id: field(form, "id") || undefined,
      token: field(form, "token") || undefined,
    },
    (await actor()) ?? { kind: "anonymous" },
  );
  revalidatePath("/admin/media");
  revalidatePath("/admin/media/record");
}

export async function discardCaptureAction(form: FormData): Promise<void> {
  await discardCapture.call({ id: field(form, "id") }, await actor());
  revalidatePath("/admin/media/record");
  redirect("/admin/media/record");
}
