// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: what devices and the server agree on for end-to-end encrypted
// messages. Runs unchanged in the browser and on the server (WebCrypto only).
//
// One MLS group (RFC 9420) per conversation, ciphersuite 1 (X25519, AES-128-GCM,
// SHA-256, Ed25519). Each device is one leaf whose basic credential is
// "userId:deviceId", signed by that device's Ed25519 key, which the server
// records when the device registers.
//
// Inside each MLS application message is a JSON payload with the body, a fresh
// franking key, and a signature by the sending device. The server keeps only
// the franking tag, HMAC(key, conversation | sender | body); a recipient who
// reports a message reveals the body and key, and the server checks them
// against the tag it stored when the message was sent, so moderation sees
// exactly what was reported and cannot be shown anything else.
import { decodeMlsMessage, getCiphersuiteFromName, getCiphersuiteImpl, type CiphersuiteImpl, type KeyPackage } from "ts-mls";
import { verifyKeyPackage } from "ts-mls/keyPackage.js";

export const SUITE = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519" as const;

let cached: Promise<CiphersuiteImpl> | null = null;
export function suite(): Promise<CiphersuiteImpl> {
  cached ??= getCiphersuiteImpl(getCiphersuiteFromName(SUITE));
  return cached;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const utf8 = (text: string): Uint8Array => encoder.encode(text);
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

export function b64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function unb64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const identityOf = (userId: string, deviceId: string): string => `${userId}:${deviceId}`;

export function parseIdentity(identity: Uint8Array): { userId: string; deviceId: string } | null {
  const match = /^([0-9a-f-]{36}):([0-9a-f-]{36})$/.exec(fromUtf8(identity));
  return match ? { userId: match[1]!, deviceId: match[2]! } : null;
}

/** A key package as sent over the wire, with what the server must check about it. */
export async function readKeyPackage(encoded: string): Promise<{ keyPackage: KeyPackage; identity: { userId: string; deviceId: string } | null; signatureKey: Uint8Array } | null> {
  let bytes: Uint8Array;
  try {
    bytes = unb64(encoded);
  } catch {
    return null;
  }
  const decoded = decodeMlsMessage(bytes, 0)?.[0];
  if (!decoded || decoded.wireformat !== "mls_key_package") return null;
  const keyPackage = decoded.keyPackage;
  if (keyPackage.cipherSuite !== SUITE) return null;
  const credential = keyPackage.leafNode.credential;
  const identity = credential.credentialType === "basic" ? parseIdentity(credential.identity) : null;
  if (!(await verifyKeyPackage(keyPackage, (await suite()).signature))) return null;
  return { keyPackage, identity, signatureKey: keyPackage.leafNode.signaturePublicKey };
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data as BufferSource));
}

const frankInput = (conversationId: string, senderUserId: string, body: string) => utf8(`freeholder:frank:v1\n${conversationId}\n${senderUserId}\n${body}`);

export async function frankTag(key: Uint8Array, conversationId: string, senderUserId: string, body: string): Promise<string> {
  return b64(await hmac(key, frankInput(conversationId, senderUserId, body)));
}

/** Constant-time comparison of two base64 tags. */
export function sameTag(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** What travels inside an MLS application message. */
export interface Payload {
  v: 1;
  body: string;
  /** The franking key, base64. */
  fk: string;
  /** The sending device, which signs `signedPart`. */
  device: string;
  sig: string;
}

const signedPart = (conversationId: string, p: Pick<Payload, "body" | "fk" | "device">) => utf8(`freeholder:payload:v1\n${conversationId}\n${p.device}\n${p.fk}\n${p.body}`);

export async function sealPayload(conversationId: string, body: string, device: { deviceId: string; signKey: Uint8Array }): Promise<{ bytes: Uint8Array; fk: string }> {
  const fk = b64(crypto.getRandomValues(new Uint8Array(32)));
  const sig = await (await suite()).signature.sign(device.signKey, signedPart(conversationId, { body, fk, device: device.deviceId }));
  const payload: Payload = { v: 1, body, fk, device: device.deviceId, sig: b64(sig) };
  return { bytes: utf8(JSON.stringify(payload)), fk };
}

/** The payload, if it is well formed and signed by the device the server says sent it. */
export async function openPayload(conversationId: string, bytes: Uint8Array, sender: { deviceId: string; signatureKey: Uint8Array }): Promise<Payload | null> {
  let parsed: Payload;
  try {
    parsed = JSON.parse(fromUtf8(bytes)) as Payload;
  } catch {
    return null;
  }
  if (parsed?.v !== 1 || typeof parsed.body !== "string" || typeof parsed.fk !== "string" || typeof parsed.sig !== "string" || parsed.device !== sender.deviceId) return null;
  const ok = await (await suite()).signature.verify(sender.signatureKey, signedPart(conversationId, parsed), unb64(parsed.sig));
  return ok ? parsed : null;
}

/** C12.24: a group call's media key, sent to the conversation's group as a control message. */
export interface CallKeyPayload {
  v: 1;
  call: string;
  key: string;
  device: string;
  sig: string;
}

const callKeyPart = (conversationId: string, p: Pick<CallKeyPayload, "call" | "key" | "device">) => utf8(`freeholder:callkey:v1\n${conversationId}\n${p.device}\n${p.call}\n${p.key}`);

export async function sealCallKey(conversationId: string, callId: string, key: string, device: { deviceId: string; signKey: Uint8Array }): Promise<Uint8Array> {
  const sig = await (await suite()).signature.sign(device.signKey, callKeyPart(conversationId, { call: callId, key, device: device.deviceId }));
  const payload: CallKeyPayload = { v: 1, call: callId, key, device: device.deviceId, sig: b64(sig) };
  return utf8(JSON.stringify(payload));
}

export async function openCallKey(conversationId: string, callId: string, bytes: Uint8Array, sender: { deviceId: string; signatureKey: Uint8Array }): Promise<string | null> {
  let parsed: CallKeyPayload;
  try {
    parsed = JSON.parse(fromUtf8(bytes)) as CallKeyPayload;
  } catch {
    return null;
  }
  if (parsed?.v !== 1 || parsed.call !== callId || parsed.device !== sender.deviceId || typeof parsed.key !== "string" || typeof parsed.sig !== "string") return null;
  const ok = await (await suite()).signature.verify(sender.signatureKey, callKeyPart(conversationId, parsed), unb64(parsed.sig));
  return ok && unb64(parsed.key).length === 32 ? parsed.key : null;
}
