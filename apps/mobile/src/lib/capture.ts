// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion ingest: picker + core media services (C10.17).
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import {
  confirmCaptureSession,
  ingestCaptureUpload,
  openCaptureSession,
  writeThrough,
  type CaptureSession,
  type CaptureSource,
} from "@freeholder/mobile-app";
import { assertOnContract, callService, type Caller } from "./screen-data";

export type PickedCapture = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

function transport(caller: Caller) {
  return {
    call<T>(service: string, body: unknown) {
      return callService<T>(caller, service, body);
    },
    async putProxy(input: { uploadId: string; filename: string; contentType: string; bytes: Uint8Array }) {
      const form = new FormData();
      form.append("uploadId", input.uploadId);
      form.append(
        "file",
        new Blob([input.bytes as BlobPart], { type: input.contentType }),
        input.filename,
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      const response = await fetch(`${caller.instanceUrl}/api/media`, {
        method: "POST",
        credentials: "omit",
        headers: caller.token ? { authorization: `Bearer ${caller.token}` } : {},
        body: form,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw Object.assign(new Error(parsed?.error?.message ?? `media.upload failed (${response.status}).`), {
          status: response.status,
        });
      }
      return (await response.json()) as { id?: string };
    },
  };
}

export async function pickCapture(source: CaptureSource): Promise<PickedCapture | null> {
  const fromCamera = source === "camera";
  const permission = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const picked = fromCamera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images", "videos"], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 1 });
  if (picked.canceled || !picked.assets[0]?.uri) return null;
  const asset = picked.assets[0];
  const mime = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
  const filename = asset.fileName || (mime.startsWith("video/") ? "capture.mp4" : "capture.jpg");
  const bytes = await new File(asset.uri).bytes();
  return { filename, contentType: mime, bytes };
}

export async function uploadPickedCapture(input: {
  caller: Caller;
  source: CaptureSource;
  file: PickedCapture;
  online: boolean;
}): Promise<CaptureSession> {
  const recording = input.source === "camera" || input.source === "screen";
  for (const service of [
    recording ? "media.createCaptureSession" : "media.createUploadLink",
    ...(recording ? ["media.grantCapturePermission"] : []),
    "media.beginUpload",
    "media.bindCaptureAsset",
    "media.confirmCapture",
  ]) {
    assertOnContract("capture", service, true);
  }
  const session = await writeThrough({ service: "media.createCaptureSession", online: input.online }, () =>
    openCaptureSession({ source: input.source, online: input.online }, transport(input.caller)),
  );
  const staged = await ingestCaptureUpload(
    { session, filename: input.file.filename, contentType: input.file.contentType, bytes: input.file.bytes, online: input.online },
    transport(input.caller),
  );
  return confirmCaptureSession({ session: staged, online: input.online }, transport(input.caller));
}
