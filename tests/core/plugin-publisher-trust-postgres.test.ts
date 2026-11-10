// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { checkPlugins } from "@/core/doctor";
import { auditLog } from "@/core/events/schema";
import { hashDirectory, publisherPublicKey, signIntegrity } from "@/core/plugins/integrity";
import { lockPublisherTrust, revokePublisherKey, setRegistryPublisherKey, trustPublisherKey } from "@/core/plugins/publisher-keys";
import { signRegistryIndex, type RegistryIndex } from "@/core/plugins/registry";
import { installedPlugins, pluginPublisherKeys } from "@/core/plugins/schema";
import { addPluginRegistry, cachePluginRegistry, enablePlugin, installPlugin, listInstalledPlugins, listPluginCatalog, listPluginRegistries, rollbackPlugin, updatePlugin } from "@/core/plugins/service";
import { type Actor } from "@/core/service";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

const old = generateKeyPairSync("ed25519");
const next = generateKeyPairSync("ed25519");
const reviewer = { ...OWNER, security: { twoFactorRequired: true, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
const directories: string[] = [];
function keyInput(key = old) {
  const publicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { publisher: "Fixture publisher", publicKey, fingerprint: publisherPublicKey(publicKey).keyId, confirmation: true as const };
}
async function artifact(version = "0.1.0", key = old) {
  const path = await mkdtemp(join(tmpdir(), "freeholder-publisher-db-test-"));
  directories.push(path);
  await writeFile(join(path, "plugin.json"), JSON.stringify({ name: "sample", version, license: "Apache-2.0", freeholder: ">=0.0.0", permissions: ["contacts:read"] }));
  await writeFile(join(path, "index.js"), `// fixture ${version}`);
  const expectedIntegrity = await hashDirectory(path);
  return { path, expectedIntegrity, signature: signIntegrity(expectedIntegrity, key.privateKey) };
}
const index: RegistryIndex = { registry: "Fixture publisher", updated: "2026-11-10", plugins: [{ name: "sample", version: "0.1.0", tier: "community", license: "Apache-2.0", freeholder: ">=0.0.0", permissions: ["contacts:read"], integrity: `sha256:${"a".repeat(64)}`, changelog: "Fixture release." }] };
const url = "https://publisher.example/index.json";

describe.runIf(hasDatabase)("publisher trust transactions (C3.42)", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
  afterAll(closeDb);

  it("requires a freshly verified owner, refusing agents, personal keys, staff and system elevation", async () => {
    const refused: Actor[] = [ANONYMOUS, STAFF, { kind: "system" }, { kind: "agent", keyName: "trust-test", scopes: ["plugins.*"] }, { ...reviewer, keyScopes: ["plugins.*"] }];
    for (const actor of refused) expect(await failure(trustPublisherKey.call(keyInput(), actor))).toMatchObject({ code: "permission" });
    expect(await failure(trustPublisherKey.call(keyInput(), OWNER))).toMatchObject({ code: "step_up_required" });
    expect(await db().select().from(pluginPublisherKeys)).toHaveLength(0);
    const key = await trustPublisherKey.call(keyInput(), reviewer);
    const [audit] = await db().select().from(auditLog).where(eq(auditLog.action, "plugins.trustPublisherKey"));
    expect(audit).toMatchObject({ actor: `user:${OWNER.userId}`, subjectType: "plugin_publisher_key", subjectId: key.keyId });
  });

  it("refuses unconfirmed fingerprints and private PEM before retaining any key material", async () => {
    const wrong = { ...keyInput(), fingerprint: "0".repeat(64) };
    expect(await failure(trustPublisherKey.call(wrong, reviewer))).toMatchObject({ code: "validation" });
    expect(await failure(trustPublisherKey.call({ ...keyInput(), confirmation: false }, reviewer))).toMatchObject({ code: "validation" });
    const privatePem = old.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(await failure(trustPublisherKey.call({ ...keyInput(), publicKey: privatePem }, reviewer))).toMatchObject({ code: "validation" });
    expect(await db().select().from(pluginPublisherKeys)).toHaveLength(0);
    expect(JSON.stringify(await db().select().from(auditLog))).not.toContain("PRIVATE KEY");
  });

  it("never trusts a key or HMAC secret supplied with an install", async () => {
    const signed = await artifact();
    expect(await failure(installPlugin.call({ ...signed, publicKey: keyInput().publicKey, signingSecret: "caller-controlled" }, OWNER))).toMatchObject({ code: "permission" });
    expect(await failure(installPlugin.call({ ...signed, signature: "sha256:deadbeef", signingSecret: "caller-controlled" }, OWNER))).toMatchObject({ code: "permission" });
    expect(await listInstalledPlugins.call({}, OWNER)).toHaveLength(0);
    await trustPublisherKey.call(keyInput(), reviewer);
    const mismatched = await failure(installPlugin.call({ ...signed, expectedIntegrity: `sha256:${"0".repeat(64)}` }, OWNER));
    expect(mismatched.code).toBe("conflict");
    expect(mismatched.message).not.toContain(signed.expectedIntegrity);
    expect(await installPlugin.call(signed, OWNER)).toMatchObject({ status: "installed", signature: signed.signature });
  });

  it("rejects unsigned updates and files changed after signing or installation", async () => {
    await trustPublisherKey.call(keyInput(), reviewer);
    const first = await artifact(); const second = await artifact("0.2.0");
    await installPlugin.call(first, OWNER);
    expect(await failure(updatePlugin.call({ path: second.path }, OWNER))).toMatchObject({ code: "validation" });
    await writeFile(join(second.path, "index.js"), "changed after signing");
    expect(await failure(updatePlugin.call({ path: second.path, signature: second.signature }, OWNER))).toMatchObject({ code: "permission" });
    expect((await listInstalledPlugins.call({}, OWNER))[0]!.version).toBe("0.1.0");
    await writeFile(join(first.path, "index.js"), "changed after installation");
    expect(await failure(enablePlugin.call({ name: "sample" }, OWNER))).toMatchObject({ code: "conflict" });
  });

  it("refuses unsigned artifacts even for an owner or a caller-defined local override", async () => {
    const local = await artifact();
    const agent: Actor = { kind: "agent", keyName: "plugin-installer", scopes: ["plugins.*"] };
    for (const actor of [agent, OWNER, reviewer]) {
      expect(await failure(installPlugin.call({ path: local.path, localTrust: true }, actor))).toMatchObject({ code: "validation" });
    }
    expect(await listInstalledPlugins.call({}, OWNER)).toHaveLength(0);
  });

  it.each([null, `sha256:${"a".repeat(64)}`])("requires owner verification to adopt an unverified legacy registration (%s)", async signature => {
    await trustPublisherKey.call(keyInput(), reviewer);
    const original = await artifact(); const replacement = await artifact("0.2.0");
    await db().insert(installedPlugins).values({ name: "sample", version: "0.1.0", source: original.path, integrity: original.expectedIntegrity, signature, status: "disabled", license: "Apache-2.0", freeholder: ">=0.0.0", installedBy: `user:${OWNER.userId}` });
    expect(await failure(enablePlugin.call({ name: "sample" }, reviewer))).toMatchObject({ code: "permission" });
    expect(await failure(updatePlugin.call({ path: replacement.path, signature: replacement.signature }, OWNER))).toMatchObject({ code: "step_up_required" });
    expect(await updatePlugin.call({ path: replacement.path, signature: replacement.signature }, reviewer)).toMatchObject({ signature: replacement.signature, status: "disabled" });
    expect(await enablePlugin.call({ name: "sample" }, OWNER)).toMatchObject({ status: "enabled" });
  });

  it("refuses a linked manifest without disclosing the unrelated file", async () => {
    const signed = await artifact();
    const outside = await mkdtemp(join(tmpdir(), "freeholder-unrelated-fixture-")); directories.push(outside);
    const secret = join(outside, "unrelated.txt"); await writeFile(secret, "SECRET_MARKER");
    await rm(join(signed.path, "plugin.json")); await symlink(secret, join(signed.path, "plugin.json"));
    const refused = await failure(installPlugin.call(signed, OWNER));
    expect(refused.code).toBe("validation");
    expect(refused.message).not.toContain("SECRET_MARKER");
    expect(await listInstalledPlugins.call({}, OWNER)).toHaveLength(0);
  });

  it("restores the actual previous signed artifact and refuses a revoked rollback", async () => {
    await trustPublisherKey.call(keyInput(), reviewer);
    await trustPublisherKey.call(keyInput(next), reviewer);
    const first = await artifact(); const second = await artifact("0.2.0", next);
    await installPlugin.call(first, OWNER);
    await updatePlugin.call({ path: second.path, signature: second.signature }, OWNER);
    await updatePlugin.call({ path: second.path, signature: second.signature }, OWNER); // Retry preserves rollback history.
    expect(await rollbackPlugin.call({ name: "sample" }, OWNER)).toMatchObject({ source: first.path, version: "0.1.0", integrity: first.expectedIntegrity, signature: first.signature });
    await rollbackPlugin.call({ name: "sample" }, OWNER);
    await revokePublisherKey.call({ keyId: keyInput().fingerprint, confirmation: true }, reviewer);
    expect(await failure(rollbackPlugin.call({ name: "sample" }, OWNER))).toMatchObject({ code: "permission" });
    expect((await listInstalledPlugins.call({}, OWNER))[0]!).toMatchObject({ source: second.path, version: "0.2.0", signature: second.signature });
  });

  it("does not treat another trusted publisher as a key rotation", async () => {
    await trustPublisherKey.call(keyInput(), reviewer);
    await trustPublisherKey.call({ ...keyInput(next), publisher: "Different publisher" }, reviewer);
    const first = await artifact(); const other = await artifact("0.2.0", next);
    await installPlugin.call(first, OWNER);
    expect(await failure(updatePlugin.call({ path: other.path, signature: other.signature }, OWNER))).toMatchObject({ code: "permission" });
    expect((await listInstalledPlugins.call({}, OWNER))[0]!.signature).toBe(first.signature);
  });

  it("pins catalogs to their owner-approved key and URL, including rotation and revocation", async () => {
    await trustPublisherKey.call(keyInput(), reviewer);
    await trustPublisherKey.call(keyInput(next), reviewer);
    expect(await failure(cachePluginRegistry.call({ url, index, signature: signRegistryIndex(index, url, old.privateKey) }, OWNER))).toMatchObject({ code: "permission" });
    expect(await listPluginRegistries.call({}, OWNER)).toHaveLength(0);
    const registry = await addPluginRegistry.call({ name: "Fixture", url, publisherKeyId: keyInput().fingerprint }, reviewer);
    await cachePluginRegistry.call({ url, index, signature: signRegistryIndex(index, url, old.privateKey) }, OWNER);
    expect(await listPluginCatalog.call({}, OWNER)).toHaveLength(1);
    expect(await failure(cachePluginRegistry.call({ url, index, signature: signRegistryIndex(index, url, next.privateKey) }, OWNER))).toMatchObject({ code: "permission" });
    const otherUrl = "https://other.example/index.json";
    await addPluginRegistry.call({ name: "Other", url: otherUrl, publisherKeyId: keyInput().fingerprint }, reviewer);
    expect(await failure(cachePluginRegistry.call({ url: otherUrl, index, signature: signRegistryIndex(index, url, old.privateKey) }, OWNER))).toMatchObject({ code: "permission" });
    await setRegistryPublisherKey.call({ id: registry.id, keyId: keyInput(next).fingerprint }, reviewer);
    expect(await listPluginCatalog.call({}, OWNER)).toHaveLength(0);
    await cachePluginRegistry.call({ url, index, signature: signRegistryIndex(index, url, next.privateKey) }, OWNER);
    await revokePublisherKey.call({ keyId: keyInput().fingerprint, confirmation: true }, reviewer);
    expect(await listPluginCatalog.call({}, OWNER)).toHaveLength(1);
    await revokePublisherKey.call({ keyId: keyInput(next).fingerprint, confirmation: true }, reviewer);
    expect(await listPluginCatalog.call({}, OWNER)).toHaveLength(0);
    expect(await failure(trustPublisherKey.call(keyInput(), reviewer))).toMatchObject({ code: "conflict" });
  });

  it("refuses a rollback if the previous directory changed", async () => {
    await trustPublisherKey.call(keyInput(), reviewer);
    const first = await artifact(); const second = await artifact("0.2.0");
    await installPlugin.call(first, OWNER);
    await updatePlugin.call({ path: second.path, signature: second.signature }, OWNER);
    await writeFile(join(first.path, "index.js"), "changed after update");
    expect(await failure(rollbackPlugin.call({ name: "sample" }, OWNER))).toMatchObject({ code: "conflict" });
    expect((await listInstalledPlugins.call({}, OWNER))[0]!.source).toBe(second.path);
  });

  it("disables signed registrations on revocation and refuses re-enable", async () => {
    await trustPublisherKey.call(keyInput(), reviewer);
    await installPlugin.call(await artifact(), OWNER);
    await enablePlugin.call({ name: "sample" }, OWNER);
    expect(await failure(revokePublisherKey.call({ keyId: keyInput().fingerprint }, reviewer))).toMatchObject({ code: "validation" });
    expect((await listInstalledPlugins.call({}, OWNER))[0]!.status).toBe("enabled");
    expect(await revokePublisherKey.call({ keyId: keyInput().fingerprint, confirmation: true }, reviewer)).toMatchObject({ disabled: 1 });
    expect((await listInstalledPlugins.call({}, OWNER))[0]!.status).toBe("disabled");
    expect(await failure(enablePlugin.call({ name: "sample" }, OWNER))).toMatchObject({ code: "permission" });
  });

  it("serializes revocation against a concurrent install", async () => {
    await trustPublisherKey.call(keyInput(), reviewer);
    const signed = await artifact();
    let release!: () => void; let held!: () => void;
    const ready = new Promise<void>(resolve => { held = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const barrier = db().transaction(async tx => { await lockPublisherTrust(tx); held(); await wait; });
    await ready;
    const results = Promise.allSettled([installPlugin.call(signed, OWNER), revokePublisherKey.call({ keyId: keyInput().fingerprint, confirmation: true }, reviewer)]);
    release(); await barrier;
    const settled = await results;
    expect(settled[1].status).toBe("fulfilled");
    expect((await listInstalledPlugins.call({}, OWNER)).every(item => item.status === "disabled")).toBe(true);
    expect(await failure(enablePlugin.call({ name: "sample" }, OWNER))).toMatchObject({ code: settled[0].status === "fulfilled" ? "permission" : "not_found" });
  });

  it("Doctor detects altered enabled bytes and catalogs signed by a revoked key", async () => {
    await trustPublisherKey.call(keyInput(), reviewer);
    const signed = await artifact();
    await installPlugin.call(signed, OWNER);
    await enablePlugin.call({ name: "sample" }, OWNER);
    await addPluginRegistry.call({ name: "Fixture", url, publisherKeyId: keyInput().fingerprint }, reviewer);
    await cachePluginRegistry.call({ url, index, signature: signRegistryIndex(index, url, old.privateKey) }, OWNER);
    expect((await checkPlugins())[0]!.verdict).toBe("ok");
    await writeFile(join(signed.path, "index.js"), "changed after enabling");
    const altered = (await checkPlugins())[0]!;
    expect(altered).toMatchObject({ id: "plugins.trust", verdict: "fail" });
    expect(altered.detail).toContain("1 enabled artifact(s) and 0 cached catalog(s)");
    await revokePublisherKey.call({ keyId: keyInput().fingerprint, confirmation: true }, reviewer);
    const revoked = (await checkPlugins())[0]!;
    expect(revoked).toMatchObject({ id: "plugins.trust", verdict: "fail" });
    expect(revoked.detail).toContain("0 enabled artifact(s) and 1 cached catalog(s)");
  });
});
