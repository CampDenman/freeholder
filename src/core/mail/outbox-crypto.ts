// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Short-lived mail bodies at rest. The queue carries only a delivery id; the
// body stays authenticated and encrypted in Postgres until delivery finishes.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { env } from "@/core/env";

const VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function material(): string[] {
  const configured = [
    env().CREDENTIAL_KEY,
    env().CREDENTIAL_KEY_PREVIOUS,
    env().SESSION_SECRET,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(configured)];
}

function key(value: string): Buffer {
  return createHash("sha256")
    .update("freeholder:mail-outbox:v1\0", "utf8")
    .update(value, "utf8")
    .digest();
}

export function encryptMailOutbox(plaintext: string, deliveryId: string): string {
  const [primary] = material();
  if (!primary) {
    throw new Error("SESSION_SECRET or CREDENTIAL_KEY is required to queue mail safely.");
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(primary), nonce);
  cipher.setAAD(Buffer.from(deliveryId, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}.${nonce.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptMailOutbox(envelope: string, deliveryId: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error("The queued mail payload has an unsupported envelope.");
  }
  const nonce = Buffer.from(parts[1]!, "base64url");
  const encrypted = Buffer.from(parts[2]!, "base64url");
  if (nonce.length !== NONCE_BYTES || encrypted.length <= TAG_BYTES) {
    throw new Error("The queued mail payload is malformed.");
  }
  const body = encrypted.subarray(0, -TAG_BYTES);
  const tag = encrypted.subarray(-TAG_BYTES);
  for (const candidate of material()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key(candidate), nonce);
      decipher.setAAD(Buffer.from(deliveryId, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      // Key rotation tries the current credential key, its predecessor, then
      // the session secret that remains the portable deployment baseline.
    }
  }
  throw new Error("The queued mail payload cannot be decrypted with the configured keys.");
}
