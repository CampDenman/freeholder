// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// HTTP Signatures as the fediverse uses them (C12.18): draft-cavage-12 with
// rsa-sha256 over (request-target), host, date and, for a body, digest.
// Mastodon, Pleroma, Misskey and GoToSocial all accept and send this form.
import { createHash, createSign, createVerify, generateKeyPairSync } from "node:crypto";

/** Requests older or newer than this are refused, to stop replays. */
const MAX_SKEW_MS = 12 * 60 * 60 * 1000;

export function newActorKeys(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

export function digestOf(body: string): string {
  return `SHA-256=${createHash("sha256").update(body).digest("base64")}`;
}

function signingString(names: string[], method: string, path: string, headers: Record<string, string>): string {
  return names
    .map((name) => (name === "(request-target)" ? `(request-target): ${method.toLowerCase()} ${path}` : `${name}: ${headers[name] ?? ""}`))
    .join("\n");
}

/** Headers to send with a signed request: date, digest (for a body) and signature. */
export function signRequest(input: {
  method: "GET" | "POST";
  url: string;
  body?: string;
  keyId: string;
  privateKeyPem: string;
  now?: Date;
  extra?: Record<string, string>;
}): Record<string, string> {
  const url = new URL(input.url);
  const headers: Record<string, string> = {
    host: url.host,
    date: (input.now ?? new Date()).toUTCString(),
    ...(input.extra ?? {}),
  };
  if (input.body !== undefined) headers.digest = digestOf(input.body);
  const names = ["(request-target)", "host", "date", ...(input.body !== undefined ? ["digest"] : [])];
  const signer = createSign("RSA-SHA256");
  signer.update(signingString(names, input.method, `${url.pathname}${url.search}`, headers));
  const signature = signer.sign(input.privateKeyPem, "base64");
  return {
    ...headers,
    signature: `keyId="${input.keyId}",algorithm="rsa-sha256",headers="${names.join(" ")}",signature="${signature}"`,
  };
}

export function parseSignature(header: string): { keyId: string; headers: string[]; signature: string } | null {
  const parts = new Map<string, string>();
  for (const match of header.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) parts.set(match[1]!, match[2]!);
  const keyId = parts.get("keyId");
  const signature = parts.get("signature");
  if (!keyId || !signature) return null;
  return { keyId, headers: (parts.get("headers") ?? "date").split(" ").filter(Boolean), signature };
}

/**
 * Verify a signed request. `headers` are lower-cased. Returns the keyId that
 * signed it, or throws with the reason.
 */
export async function verifyRequest(input: {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  publicKeyFor: (keyId: string) => Promise<string | null>;
  now?: Date;
}): Promise<string> {
  const parsed = parseSignature(input.headers.signature ?? "");
  if (!parsed) throw new Error("The request is not signed.");
  const required = ["(request-target)", "host", "date", ...(input.body !== undefined ? ["digest"] : [])];
  for (const name of required) {
    if (!parsed.headers.includes(name)) throw new Error(`The signature does not cover ${name}.`);
  }
  const date = Date.parse(input.headers.date ?? "");
  if (!Number.isFinite(date) || Math.abs((input.now ?? new Date()).getTime() - date) > MAX_SKEW_MS) {
    throw new Error("The request date is missing or too far from now.");
  }
  if (input.body !== undefined && input.headers.digest !== digestOf(input.body)) {
    throw new Error("The body does not match its digest.");
  }
  const pem = await input.publicKeyFor(parsed.keyId);
  if (!pem) throw new Error("The signing key could not be found.");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingString(parsed.headers, input.method, input.path, input.headers));
  if (!verifier.verify(pem, parsed.signature, "base64")) throw new Error("The signature does not verify.");
  return parsed.keyId;
}
