// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Encrypting an owner's third-party credentials (MASTER.md §41, §17).
//
// §17 puts secrets in the environment and configuration in the database, and
// OAuth refresh tokens break that rule honestly: they are per-account, created
// at runtime and rotated by the provider, so they cannot live in an env file.
// §41 states the addendum this file implements:
//
//   > The secret in the environment is the key that encrypts the secrets in
//   > the database.
//
// AES-256-GCM, a fresh 12-byte nonce per encryption, and the authentication
// tag kept with the ciphertext. A database dump on its own yields nothing
// usable; a compromised box yields what a compromised box was always going to.
//
// ── Two decisions worth knowing about ─────────────────────────────────────
//
// **Ciphertext is bound to the row it belongs to.** The account's id is passed
// as additional authenticated data, so a token lifted from one row and pasted
// into another fails to decrypt rather than silently authenticating as
// somebody else's account. GCM gives this for free and it costs nothing; the
// only requirement is that the id exists before the encryption, which is why
// the service generates it rather than letting the column default to one.
//
// **The envelope is versioned.** `v1.<nonce>.<ciphertext+tag>`, base64url. An
// algorithm change later is then a new prefix that old rows keep working
// through, rather than a flag day or a guess about what a bare blob contains.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@/core/env";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class CredentialKeyError extends Error {}

/**
 * A configured key as raw bytes.
 *
 * Hex or base64url, because both are what a person gets from the tools they
 * are likely to reach for, and guessing wrong about which produces a key that
 * is silently the wrong length.
 */
function parseKey(value: string, name: string): Buffer {
  const trimmed = value.trim();
  const decoded = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64url");

  if (decoded.length !== KEY_BYTES) {
    throw new CredentialKeyError(
      `${name} must be ${KEY_BYTES} bytes — 64 hex characters, or base64url of 32 bytes. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return decoded;
}

/** The key new ciphertext is written with. */
export function currentKey(): Buffer {
  const value = env().CREDENTIAL_KEY;
  if (!value) {
    throw new CredentialKeyError(
      "CREDENTIAL_KEY is not set, so connected accounts cannot be stored. See .env.example.",
    );
  }
  return parseKey(value, "CREDENTIAL_KEY");
}

/**
 * Every key that may have written existing ciphertext, newest first.
 *
 * Rotation is a supported operation rather than a reinstall (§41), and this is
 * how: set the new key as `CREDENTIAL_KEY` and the old one as
 * `CREDENTIAL_KEY_PREVIOUS`, deploy, and everything keeps working while
 * `connections.rotateCredentials` re-encrypts in the background. Once it has
 * finished, the previous key can be removed.
 */
function decryptionKeys(): Buffer[] {
  const keys = [currentKey()];
  const previous = env().CREDENTIAL_KEY_PREVIOUS;
  if (previous) keys.push(parseKey(previous, "CREDENTIAL_KEY_PREVIOUS"));
  return keys;
}

/** True when a key is configured at all, without throwing. Used by doctor. */
export function credentialKeyConfigured(): boolean {
  return Boolean(env().CREDENTIAL_KEY);
}

/**
 * Encrypt a secret, bound to `aad`.
 *
 * `aad` is the id of the row this belongs to. It is authenticated but not
 * secret — it is not stored in the envelope, because the caller always knows
 * which row it is reading.
 */
export function encryptSecret(plaintext: string, aad: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, currentKey(), nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}.${nonce.toString("base64url")}.${body.toString("base64url")}`;
}

/**
 * Decrypt, trying the current key and then the previous one.
 *
 * A wrong key, a tampered ciphertext and a mismatched `aad` all fail the same
 * way — GCM authenticates before it returns anything — so there is nothing to
 * distinguish and nothing an attacker learns from the difference.
 */
export function decryptSecret(envelope: string, aad: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new CredentialKeyError(
      "That stored credential is not in a format this version understands.",
    );
  }

  const nonce = Buffer.from(parts[1]!, "base64url");
  const body = Buffer.from(parts[2]!, "base64url");
  if (nonce.length !== NONCE_BYTES || body.length <= TAG_BYTES) {
    throw new CredentialKeyError("That stored credential is malformed.");
  }

  const ciphertext = body.subarray(0, body.length - TAG_BYTES);
  const tag = body.subarray(body.length - TAG_BYTES);

  let lastError: unknown;
  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, nonce);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw new CredentialKeyError(
    "That stored credential could not be decrypted with the configured key. If CREDENTIAL_KEY was changed, set the old value as CREDENTIAL_KEY_PREVIOUS and re-run the rotation.",
    { cause: lastError },
  );
}

/**
 * Whether a stored envelope was written with the *current* key.
 *
 * What rotation iterates on: a row that already decrypts under the current key
 * needs no work, so a rotation that is interrupted and re-run picks up where
 * it stopped rather than starting over.
 */
export function needsRotation(envelope: string, aad: string): boolean {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return true;
  try {
    const nonce = Buffer.from(parts[1]!, "base64url");
    const body = Buffer.from(parts[2]!, "base64url");
    const decipher = createDecipheriv(ALGORITHM, currentKey(), nonce);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    decipher.update(body.subarray(0, body.length - TAG_BYTES));
    decipher.final();
    return false;
  } catch {
    return true;
  }
}

/**
 * Prove the configured key can round-trip, for doctor.
 *
 * A key that parses and a key that works are the same thing here, but saying
 * so by doing it is the house style: doctor tries things rather than reading
 * settings back (§17).
 */
export function credentialKeyWorks(): boolean {
  const probe = "freeholder-credential-probe";
  const aad = "doctor";
  const round = decryptSecret(encryptSecret(probe, aad), aad);
  const a = Buffer.from(round);
  const b = Buffer.from(probe);
  return a.length === b.length && timingSafeEqual(a, b);
}
