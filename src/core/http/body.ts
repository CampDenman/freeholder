// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Request helpers that enforce a byte limit while the stream is being read.
// Checking after request.text()/json()/formData() has already allowed an
// attacker to make the process retain the entire body.

export const DEFAULT_JSON_BODY_LIMIT = 1024 * 1024;

export class RequestBodyError extends Error {
  constructor(
    public readonly status: 400 | 411 | 413,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

interface BodySource {
  headers: Headers;
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
}

function declaredLength(source: BodySource): number | undefined {
  const raw = source.headers.get("content-length");
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw)) throw new RequestBodyError(400, "Content-Length is invalid.");
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) {
    throw new RequestBodyError(400, "Content-Length is invalid.");
  }
  return length;
}

function positiveLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive safe integer.");
  }
}

export async function readBoundedBytes(
  source: BodySource,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  positiveLimit(maxBytes);
  const length = declaredLength(source);
  if (length !== undefined && length > maxBytes) {
    throw new RequestBodyError(413, "The request body is too large.");
  }
  if (!source.body) return new Uint8Array();

  const reader = source.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      received += part.value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(413, "The request body is too large.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder().decode(await readBoundedBytes(request, maxBytes));
}

export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const bytes = await readBoundedBytes(request, maxBytes);
  const contentType = request.headers.get("content-type");
  if (!contentType) throw new RequestBodyError(400, "Content-Type is required.");
  return new Response(bytes, {
    headers: { "content-type": contentType },
  }).formData();
}
