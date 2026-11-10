// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashDirectory, MAX_ARTIFACT_BYTES, publisherPublicKey, signIntegrity, signatureKeyId, signPublisherPayload, verifySignature } from "@/core/plugins/integrity";
import { signRegistryIndex, verifyRegistryIndex, type RegistryIndex } from "@/core/plugins/registry";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "freeholder-publisher-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("publisher artifact integrity (C3.42)", () => {
  it("distinguishes embedded NUL bytes from a second file", async () => {
    const single = await directory();
    const multiple = await directory();
    await writeFile(join(single, "a.bin"), "one\0b.bin\0two");
    await writeFile(join(multiple, "a.bin"), "one");
    await writeFile(join(multiple, "b.bin"), "two");
    expect(await hashDirectory(single)).not.toBe(await hashDirectory(multiple));
  });

  it.each(["node_modules", ".git"])("covers bytes below %s in the installed directory", async folder => {
    const path = await directory();
    await writeFile(join(path, "plugin.json"), "{}");
    await mkdir(join(path, folder, "dependency"), { recursive: true });
    const dependency = join(path, folder, "dependency", "index.js");
    await writeFile(dependency, "original dependency");
    const before = await hashDirectory(path);
    await writeFile(dependency, "changed dependency");
    expect(await hashDirectory(path)).not.toBe(before);
  });

  it.skipIf(process.platform === "win32")("refuses a literal backslash that could alias another platform's path separator", async () => {
    const path = await directory();
    await writeFile(join(path, "a\\b"), "ambiguous path");
    await expect(hashDirectory(path)).rejects.toThrow(/portable UTF-8/);
  });

  it("refuses a symbolic link outside the signed tree", async () => {
    const path = await directory();
    const outside = await directory();
    await writeFile(join(outside, "outside.js"), "outside the artifact");
    await symlink(join(outside, "outside.js"), join(path, "linked.js"));
    await expect(hashDirectory(path)).rejects.toThrow(/symbolic link/i);
  });

  it("binds empty directory entries", async () => {
    const path = await directory(); const before = await hashDirectory(path);
    await mkdir(join(path, "configuration"));
    expect(await hashDirectory(path)).not.toBe(before);
  });

  it("refuses an oversized sparse file before reading its contents", async () => {
    const path = await directory(); const large = join(path, "oversized.bin");
    await writeFile(large, ""); await truncate(large, MAX_ARTIFACT_BYTES + 1);
    await expect(hashDirectory(path)).rejects.toThrow(/1 GiB/);
  });
});

describe("Ed25519 publisher signatures (C3.42)", () => {
  const signer = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const pem = signer.publicKey.export({ type: "spki", format: "pem" }).toString();
  const otherPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();
  const integrity = `sha256:${"a".repeat(64)}`;
  const index: RegistryIndex = { registry: "Publisher", updated: "2026-11-10", plugins: [] };
  const url = "https://publisher.example/index.json";

  it("verifies a signed artifact only with its publisher's public key", () => {
    const signature = signIntegrity(integrity, signer.privateKey);
    expect(signatureKeyId(signature)).toBe(publisherPublicKey(pem).keyId);
    expect(verifySignature(integrity, signature, pem)).toBe(true);
    expect(verifySignature(integrity, signature, otherPem)).toBe(false);
    expect(verifySignature(`sha256:${"b".repeat(64)}`, signature, pem)).toBe(false);
    expect(verifySignature(integrity, `${signature.slice(0, -2)}xx`, pem)).toBe(false);
  });

  it("refuses legacy HMACs, private key material and non-Ed25519 keys", () => {
    expect(signatureKeyId(`sha256:${"a".repeat(64)}`)).toBeNull();
    expect(verifySignature(integrity, "sha256:deadbeef", pem)).toBe(false);
    const privatePem = signer.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => publisherPublicKey(privatePem)).toThrow(/public key/i);
    expect(() => publisherPublicKey(`${pem}${privatePem}${pem}`)).toThrow(/public key/i);
    const disguisedPrivate = `-----BEGIN PUBLIC KEY-----\n${signer.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")}\n-----END PUBLIC KEY-----\n`;
    expect(() => publisherPublicKey(disguisedPrivate)).toThrow();
    expect(verifySignature(integrity, signIntegrity(integrity, signer.privateKey), privatePem)).toBe(false);
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(() => publisherPublicKey(ec.publicKey.export({ type: "spki", format: "pem" }).toString())).toThrow(/Ed25519/);
    expect(() => signIntegrity(integrity, ec.privateKey)).toThrow(/Ed25519/);
  });

  it("binds registry signatures to their URL and complete canonical index", () => {
    const signature = signRegistryIndex(index, url, signer.privateKey);
    expect(verifyRegistryIndex(index, url, signature, pem)).toBe(true);
    expect(verifyRegistryIndex(index, "https://other.example/index.json", signature, pem)).toBe(false);
    expect(verifyRegistryIndex({ ...index, registry: "Impostor" }, url, signature, pem)).toBe(false);
    expect(verifyRegistryIndex(index, url, signature, otherPem)).toBe(false);
  });

  it("separates artifact and catalog signing purposes", () => {
    const wrongPurpose = signPublisherPayload("registry", integrity, signer.privateKey);
    expect(verifySignature(integrity, wrongPurpose, pem)).toBe(false);
  });

  it("normalizes public PEM line endings without changing the fingerprint", () => {
    expect(publisherPublicKey(pem.replaceAll("\n", "\r\n"))).toEqual(publisherPublicKey(pem));
  });

  it("signs actual artifacts and catalogs through the publisher CLI without echoing private material", async () => {
    const artifact = await directory(); const keys = await directory();
    await writeFile(join(artifact, "index.js"), "// publisher CLI fixture");
    const privatePath = join(keys, "private.pem"); const publicPath = join(keys, "public.pem");
    await writeFile(privatePath, signer.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    await writeFile(publicPath, pem);
    const run = promisify(execFile);
    const fingerprint = await run(process.execPath, ["scripts/sign-plugin.mjs", "fingerprint", "--public-key", publicPath]);
    expect(fingerprint.stdout.trim()).toBe(publisherPublicKey(pem).keyId);
    const result = await run(process.execPath, ["scripts/sign-plugin.mjs", "artifact", "--directory", artifact, "--private-key", privatePath]);
    const signed = JSON.parse(result.stdout) as { integrity: string; signature: string };
    expect(signed.integrity).toBe(await hashDirectory(artifact));
    expect(verifySignature(signed.integrity, signed.signature, pem)).toBe(true);
    expect(result.stdout + result.stderr).not.toContain("PRIVATE KEY");
    const indexPath = join(keys, "index.json"); await writeFile(indexPath, JSON.stringify(index));
    const catalog = await run(process.execPath, ["scripts/sign-plugin.mjs", "registry", "--index", indexPath, "--url", url, "--private-key", privatePath]);
    expect(verifyRegistryIndex(index, url, (JSON.parse(catalog.stdout) as { signature: string }).signature, pem)).toBe(true);
    const error: unknown = await run(process.execPath, ["scripts/sign-plugin.mjs", "registry", "--index", privatePath, "--url", url, "--private-key", privatePath]).then(() => { throw new Error("Expected refusal"); }, (failure: unknown) => failure);
    expect(error).toMatchObject({ code: 2, stdout: "" });
    expect(JSON.stringify(error)).not.toContain("PRIVATE KEY");
  });
});
