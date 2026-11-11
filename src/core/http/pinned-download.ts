// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Bounded, redirect-free GET transport for URLs supplied outside the process.
// DNS is resolved once, every answer is checked, and the chosen address is
// pinned to the socket while Host/SNI retain the original identity.
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import {
  pinnedRequestOptions,
  resolveWebhookTarget,
  type WebhookTransportOptions,
} from "@/core/webhooks/transport";

export interface PinnedDownloadOptions extends WebhookTransportOptions {
  maxBytes: number;
  headers?: Record<string, string>;
}

export interface PinnedRequestOptions extends PinnedDownloadOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  body?: Uint8Array<ArrayBuffer>;
  signal?: AbortSignal;
}

export class PinnedDownloadError extends Error {
  readonly pluginOperationalFailure = true;
  constructor(
    public readonly code: "timeout" | "too_large" | "network",
    message: string,
  ) {
    super(message);
    this.name = "PinnedDownloadError";
  }
}

export async function getPinnedBytes(
  raw: string,
  options: PinnedDownloadOptions,
): Promise<{
  status: number;
  contentType: string | undefined;
  bytes: Uint8Array<ArrayBuffer>;
}> {
  const { status, contentType, bytes } = await requestPinnedBytes(raw, { ...options, method: "GET", body: undefined });
  return { status, contentType, bytes };
}

/** The same pinned connection for bounded plugin API requests (C3.41). */
export async function requestPinnedBytes(
  raw: string,
  options: PinnedRequestOptions,
): Promise<{ status: number; contentType: string | undefined; bytes: Uint8Array<ArrayBuffer>; headers: Headers }> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive number of milliseconds.");
  }
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new Error("maxBytes must be a positive safe integer.");
  }

  const startedAt = Date.now();
  options.signal?.throwIfAborted();
  const target = await resolveWebhookTarget(raw, {
    ...options,
    allowLocal: options.allowLocal ?? false,
  });
  const remainingMs = timeoutMs - (Date.now() - startedAt);
  options.signal?.throwIfAborted();
  if (remainingMs <= 0) {
    throw new PinnedDownloadError("timeout", "The download timed out.");
  }
  const request = target.url.protocol === "https:" ? requestHttps : requestHttp;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", abort);
      operation();
    };
    const outgoing = request(
      {
        ...pinnedRequestOptions(target, options.headers ?? {}),
        method: options.method ?? "GET",
      },
      (incoming) => {
        const declared = Number(incoming.headers["content-length"]);
        if (options.method !== "HEAD" && Number.isFinite(declared) && declared > options.maxBytes) {
          finish(() => reject(new PinnedDownloadError(
            "too_large",
            "The download is larger than the configured byte limit.",
          )));
          incoming.destroy();
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        incoming.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += bytes.byteLength;
          if (received > options.maxBytes) {
            finish(() => reject(new PinnedDownloadError(
              "too_large",
              "The download is larger than the configured byte limit.",
            )));
            incoming.destroy();
            return;
          }
          chunks.push(bytes);
        });
        incoming.on("end", () => finish(() => {
          const body = Buffer.concat(chunks);
          const contentType = incoming.headers["content-type"];
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
            else if (value !== undefined) headers.set(name, value);
          }
          resolve({
            status: incoming.statusCode ?? 0,
            contentType: typeof contentType === "string" ? contentType : undefined,
            bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
            headers,
          });
        }));
        incoming.on("error", (error) => finish(() => reject(error)));
      },
    );
    const deadline = setTimeout(() => {
      outgoing.destroy(new PinnedDownloadError("timeout", "The download timed out."));
    }, remainingMs);
    const abort = () => outgoing.destroy(new PinnedDownloadError("network", "The request was cancelled."));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    outgoing.on("error", (error) => finish(() => reject(
      error instanceof PinnedDownloadError
        ? error
        : new PinnedDownloadError("network", "The download failed."),
    )));
    outgoing.end(options.body);
  });
}
