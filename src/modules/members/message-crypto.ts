// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Member message bodies at rest (MASTER.md §44.6, C12.06).
//
// This is encryption at rest, bound to each message id, with the site's key:
// a copy of the database alone does not reveal what members said. It is not
// end-to-end encryption — the server can still decrypt. End-to-end encryption
// with MLS (RFC 9420), where only members' devices hold keys, is C12.23.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/core/env";

const VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function material(): string[] {
  const configured = [env().CREDENTIAL_KEY, env().CREDENTIAL_KEY_PREVIOUS, env().SESSION_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(configured)];
}

function key(value: string): Buffer {
  return createHash("sha256").update("freeholder:member-messages:v1\0", "utf8").update(value, "utf8").digest();
}

export function sealMessage(plaintext: string, messageId: string): string {
  const [primary] = material();
  if (!primary) throw new Error("SESSION_SECRET or CREDENTIAL_KEY is required to store messages safely.");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(primary), nonce);
  cipher.setAAD(Buffer.from(messageId, "utf8"));
  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${nonce.toString("base64url")}.${sealed.toString("base64url")}`;
}

export function openMessage(envelope: string, messageId: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error("That message has an unsupported envelope.");
  const nonce = Buffer.from(parts[1]!, "base64url");
  const sealed = Buffer.from(parts[2]!, "base64url");
  if (nonce.length !== NONCE_BYTES || sealed.length < TAG_BYTES) throw new Error("That message is malformed.");
  const body = sealed.subarray(0, -TAG_BYTES);
  const tag = sealed.subarray(-TAG_BYTES);
  for (const candidate of material()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key(candidate), nonce);
      decipher.setAAD(Buffer.from(messageId, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      // Try the previous key during rotation, then the session secret.
    }
  }
  throw new Error("That message cannot be decrypted with the configured keys.");
}
