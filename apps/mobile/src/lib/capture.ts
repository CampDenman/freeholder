// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner companion ingest: picker + core media services (C10.17).
import * as ImagePicker from "expo-image-picker";
import { File, FileMode } from "expo-file-system";
import {
  captureBatchOwner,
  captureStartService,
  confirmCaptureSession,
  ingestCaptureUpload,
  openCaptureSession,
  SCREENS,
  writeThrough,
  type CaptureBatch,
  type CaptureConsent,
  type CaptureDestination,
  type CaptureFile,
  type CaptureSession,
  type CaptureSource,
  type CaptureTransport,
} from "@freeholder/mobile-app";
import { captureBatches } from "./capture-store";
import { assertOnContract, callService, type Caller } from "./screen-data";

function transport(caller: Caller) {
  return {
    call<T>(service: string, body: unknown) {
      assertOnContract("capture", service, SCREENS.capture.writes.includes(service));
      return callService<T>(caller, service, body);
    },
    async putProxy(input: { uploadId: string; filename: string; contentType: string; bytes?: Uint8Array; uri?: string; signal?: AbortSignal }) {
      const form = new FormData();
      form.append("uploadId", input.uploadId);
      if (input.uri) {
        form.append("file", { uri: input.uri, name: input.filename, type: input.contentType } as unknown as Blob);
      } else if (input.bytes) {
        form.append("file", new Blob([input.bytes as BlobPart], { type: input.contentType }), input.filename);
      } else {
        throw new Error("Nothing to upload.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      const onAbort = () => controller.abort();
      input.signal?.addEventListener("abort", onAbort);
      const response = await fetch(`${caller.instanceUrl}/api/media`, {
        method: "POST",
        credentials: "omit",
        headers: caller.token ? { authorization: `Bearer ${caller.token}` } : {},
        body: form,
        signal: controller.signal,
      }).finally(() => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
      });
      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw Object.assign(new Error(parsed?.error?.message ?? `media.upload failed (${response.status}).`), {
          status: response.status,
        });
      }
      return (await response.json()) as { id?: string };
    },
    async putPart(input: { url: string; start: number; end: number; bytes?: Uint8Array; uri?: string; signal?: AbortSignal }) {
      let body: Uint8Array;
      if (input.uri) {
        const handle = new File(input.uri).open(FileMode.ReadOnly);
        try {
          handle.offset = input.start;
          body = handle.readBytes(input.end - input.start);
        } finally {
          handle.close();
        }
      } else if (input.bytes) {
        body = input.bytes.subarray(input.start, input.end);
      } else {
        throw new Error("Nothing to upload.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      const onAbort = () => controller.abort();
      input.signal?.addEventListener("abort", onAbort);
      const response = await fetch(input.url, { method: "PUT", body: body as BlobPart, signal: controller.signal }).finally(() => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
      });
      const etag = response.headers.get("etag");
      if (!response.ok || !etag) {
        throw new Error(`Part upload failed (${response.status}).`);
      }
      return { etag };
    },
  };
}

function toCaptureFile(asset: ImagePicker.ImagePickerAsset): CaptureFile | null {
  if (!asset.uri) return null;
  const mime = asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg");
  const filename = asset.fileName || (mime.startsWith("video/") ? "capture.mp4" : "capture.jpg");
  const size = asset.fileSize ?? new File(asset.uri).size ?? 0;
  if (size === 0) return null;
  return { filename, contentType: mime, uri: asset.uri, byteLength: size };
}

export async function pickCapture(source: CaptureSource): Promise<CaptureFile[]> {
  const fromCamera = source === "camera" || source === "screen";
  const permission = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];
  const picked = fromCamera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images", "videos"], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        quality: 1,
        allowsMultipleSelection: source === "camera_roll" || source === "share_sheet",
      });
  if (picked.canceled) return [];
  return picked.assets.map(toCaptureFile).filter((file): file is CaptureFile => file !== null);
}

export function captureTransport(caller: Caller): CaptureTransport {
  return transport(caller);
}

export async function enqueuePickedCapture(input: {
  caller: Caller;
  source: CaptureSource;
  files: CaptureFile[];
  destination: CaptureDestination;
  consent: CaptureConsent;
}): Promise<CaptureBatch> {
  if (!input.caller.token) throw new Error("Sign in before capturing.");
  return captureBatches.enqueue({
    source: input.source,
    files: input.files,
    destination: input.destination,
    consent: input.consent,
    owner: await captureBatchOwner({ instanceUrl: input.caller.instanceUrl, token: input.caller.token }),
  });
}

export async function uploadPickedCapture(input: {
  caller: Caller;
  source: CaptureSource;
  file: CaptureFile;
  online: boolean;
}): Promise<CaptureSession> {
  const start = captureStartService(input.source);
  for (const service of [
    start,
    ...(start === "media.createCaptureSession" ? ["media.grantCapturePermission"] : []),
    "media.beginUpload",
    "media.signUploadParts",
    "media.completeUpload",
    "media.bindCaptureAsset",
    "media.confirmCapture",
  ]) {
    assertOnContract("capture", service, true);
  }
  const session = await writeThrough({ service: start, online: input.online }, () =>
    openCaptureSession({ source: input.source, online: input.online }, transport(input.caller)),
  );
  const staged = await ingestCaptureUpload({ session, file: input.file, online: input.online }, transport(input.caller));
  return confirmCaptureSession({ session: staged, online: input.online }, transport(input.caller));
}
