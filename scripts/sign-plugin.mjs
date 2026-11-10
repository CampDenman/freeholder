// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.42 publisher-side tooling. Never imports the instance or its environment.
import { readFile, stat } from "node:fs/promises";

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("node-version");
  const [command, ...args] = process.argv.slice(2);
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1] || values.has(args[i])) throw new Error("arguments");
    values.set(args[i], args[i + 1]);
  }
  const required = command === "fingerprint" ? ["--public-key"]
    : command === "artifact" ? ["--directory", "--private-key"]
    : command === "registry" ? ["--index", "--url", "--private-key"] : [];
  if (!required.length || values.size !== required.length || required.some(key => !values.get(key))) throw new Error("arguments");
  const { hashDirectory, publisherPublicKey, signIntegrity, signatureKeyId } = await import("../src/core/plugins/integrity.ts");
  if (command === "fingerprint") {
    console.log(publisherPublicKey(await readFile(values.get("--public-key"), "utf8")).keyId);
    return;
  }
  const keyPath = values.get("--private-key");
  if (process.platform !== "win32" && ((await stat(keyPath)).mode & 0o077) !== 0) throw new Error("key-permissions");
  const privateKey = await readFile(keyPath, "utf8");
  if (command === "artifact") {
    const integrity = await hashDirectory(values.get("--directory"));
    const signature = signIntegrity(integrity, privateKey);
    console.log(JSON.stringify({ integrity, signature, keyId: signatureKeyId(signature) }));
    return;
  }
  const { parseRegistryIndex, signRegistryIndex } = await import("../src/core/plugins/registry.ts");
  const url = new URL(values.get("--url"));
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("registry-url");
  const index = parseRegistryIndex(JSON.parse(await readFile(values.get("--index"), "utf8")));
  const signature = signRegistryIndex(index, url.href, privateKey);
  console.log(JSON.stringify({ signature, keyId: signatureKeyId(signature) }));
}

await main().catch(() => {
  // Malformed input could be a private PEM file passed as --index. Never
  // echo parser errors, file contents or private key material to a terminal.
  console.error("Signing failed. Use Node 24+, an Ed25519 key and a self-contained artifact or valid registry index. Private key files must have mode 600.");
  console.error("Usage: node scripts/sign-plugin.mjs fingerprint --public-key FILE | artifact --directory DIR --private-key FILE | registry --index FILE --url HTTPS_URL --private-key FILE");
  process.exitCode = 2;
});
