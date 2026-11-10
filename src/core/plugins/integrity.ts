// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Artifact hashing and publisher signatures (C3.09, C3.42).
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { readdir, open, lstat } from "node:fs/promises";
import { join, relative } from "node:path";

export const MAX_ARTIFACT_BYTES = 1024 ** 3;
const MAX_ARTIFACT_ENTRIES = 100_000;
const MAX_ARTIFACT_DEPTH = 64;

export async function hashDirectory(root: string): Promise<string> {
  await assertDirectory(root);
  const hash = createHash("sha256").update("freeholder-plugin-directory/v2\n");
  let entriesSeen = 0; let bytesSeen = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_ARTIFACT_DEPTH) throw new Error("The plugin directory is too deeply nested.");
    // Plugin directories are selected by the owner after deployment. These
    // comments keep the build tracer from treating each variable path as a
    // request to package every file under the repository root.
    const entries = await readdir(/* turbopackIgnore: true */ dir, {
      withFileTypes: true,
      encoding: "buffer",
    });
    for (const entry of entries.sort((a, b) => Buffer.compare(a.name, b.name))) {
      if (++entriesSeen > MAX_ARTIFACT_ENTRIES) throw new Error("The plugin contains too many files or directories.");
      const name = entry.name.toString("utf8");
      if (!Buffer.from(name).equals(entry.name) || name.includes("\\")) throw new Error("Plugin files need portable UTF-8 names without backslashes.");
      if (entry.isSymbolicLink()) throw new Error("A signed plugin cannot contain a symbolic link.");
      const path = join(/* turbopackIgnore: true */ dir, name);
      const relativePath = Buffer.from(relative(root, path).replaceAll("\\", "/"));
      if (entry.isDirectory()) {
        hash.update(`D${relativePath.length}:`).update(relativePath);
        await walk(path, depth + 1);
      } else if (entry.isFile()) {
        const file = await open(/* turbopackIgnore: true */ path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const before = await file.stat({ bigint: true });
          if (!before.isFile()) throw new Error("The artifact contains a non-regular file.");
          if (before.size > BigInt(MAX_ARTIFACT_BYTES) || bytesSeen + Number(before.size) > MAX_ARTIFACT_BYTES) throw new Error("The plugin exceeds the 1 GiB artifact limit.");
          bytesSeen += Number(before.size);
          // Include entry kind and lengths, including empty directories. No
          // file bytes can be mistaken for another path or entry boundary.
          hash.update(`F${relativePath.length}:`).update(relativePath).update(`${before.size}:`);
          let read = 0n;
          for await (const chunk of file.createReadStream({ autoClose: false })) {
            if (!Buffer.isBuffer(chunk)) throw new Error("Invalid artifact stream.");
            read += BigInt(chunk.length);
            if (read > before.size) throw new Error("Plugin files changed during verification.");
            hash.update(chunk);
          }
          const after = await file.stat({ bigint: true });
          if (read !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error("Plugin files changed during verification.");
        } finally { await file.close(); }
      } else throw new Error("A signed plugin can contain only regular files and directories.");
    }
  }
  await walk(root, 0);
  return `sha256:${hash.digest("hex")}`;
}

export async function assertDirectory(path: string): Promise<void> {
  const info = await lstat(/* turbopackIgnore: true */ path).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`No plugin directory at ${path}.`);
  }
}

export const PUBLISHER_KEY_ID = /^[a-f0-9]{64}$/;
const SIGNATURE = /^ed25519:([a-f0-9]{64}):([A-Za-z0-9_-]{86})$/;

/** Accept only a public SPKI key; never accept/store private PEM material. */
export function publisherPublicKey(pem: string): { publicKey: string; keyId: string } {
  if (pem.length > 2048) throw new Error("Provide an Ed25519 public key in PUBLIC KEY PEM format.");
  const match = /^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END PUBLIC KEY-----\s*$/.exec(pem);
  if (!match) {
    throw new Error("Provide an Ed25519 public key in PUBLIC KEY PEM format.");
  }
  const encoded = match[1]!.replace(/[\r\n]/g, "");
  const supplied = Buffer.from(encoded, "base64");
  if (supplied.toString("base64") !== encoded) throw new Error("Invalid public key encoding.");
  const key = createPublicKey({ key: supplied, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Publisher keys must use Ed25519.");
  const der = key.export({ type: "spki", format: "der" });
  if (!der.equals(supplied)) throw new Error("Use the public key's canonical SPKI encoding.");
  return {
    publicKey: key.export({ type: "spki", format: "pem" }).toString(),
    keyId: createHash("sha256").update(der).digest("hex"),
  };
}

export function signatureKeyId(signature: string): string | null {
  const match = SIGNATURE.exec(signature);
  if (!match || Buffer.from(match[2]!, "base64url").toString("base64url") !== match[2]) return null;
  return match[1]!;
}

function signedBytes(purpose: "artifact" | "registry", keyId: string, payload: string): Buffer {
  return Buffer.from(`freeholder-plugin-${purpose}/v1\n${keyId}\n${payload}`);
}

/** Publisher-side helper. No service accepts or stores this private key. */
export function signPublisherPayload(purpose: "artifact" | "registry", payload: string, privateKey: string | KeyObject): string {
  const key = typeof privateKey === "string" ? createPrivateKey(privateKey) : privateKey;
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("Signing requires an Ed25519 private key.");
  const { keyId } = publisherPublicKey(createPublicKey(key).export({ type: "spki", format: "pem" }).toString());
  return `ed25519:${keyId}:${sign(null, signedBytes(purpose, keyId, payload), key).toString("base64url")}`;
}

export function verifyPublisherPayload(purpose: "artifact" | "registry", payload: string, signature: string, publicKey: string): boolean {
  try {
    const keyId = signatureKeyId(signature);
    const key = publisherPublicKey(publicKey);
    if (!keyId || keyId !== key.keyId) return false;
    const bytes = Buffer.from(signature.split(":")[2]!, "base64url");
    return verify(null, signedBytes(purpose, keyId, payload), key.publicKey, bytes);
  } catch { return false; }
}

export function signIntegrity(integrity: string, privateKey: string | KeyObject): string {
  return signPublisherPayload("artifact", integrity, privateKey);
}

export function verifySignature(integrity: string, signature: string, publicKey: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(integrity) && verifyPublisherPayload("artifact", integrity, signature, publicKey);
}
