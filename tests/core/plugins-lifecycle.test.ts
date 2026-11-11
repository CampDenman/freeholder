// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Plugin install, enable, update, rollback, uninstall (C3.09–C3.11).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import {
  addPluginRegistry,
  cachePluginRegistry,
  disablePlugin,
  enablePlugin,
  installPlugin,
  listInstalledPlugins,
  listPluginCatalog,
  listPluginRegistries,
  rollbackPlugin,
  uninstallPlugin,
  updatePlugin,
} from "@/core/plugins/service";
import { signRegistryIndex, type RegistryIndex } from "@/core/plugins/registry";
import { hashDirectory, publisherPublicKey, signIntegrity } from "@/core/plugins/integrity";
import { trustPublisherKey } from "@/core/plugins/publisher-keys";
import { isolatePlugins } from "@/core/plugins/isolate";
import { definePlugin } from "@freeholder/plugin-kit";
import {
  commitImport,
  previewImport,
  publishImport,
  reconcileImport,
  rollbackImport,
  startImport,
} from "@/core/import/service";
import { assertPublicHttpUrl } from "@/core/import/contract";
import { pages } from "@/modules/cms/schema";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const SIGNER = generateKeyPairSync("ed25519");
const PUBLIC_KEY = SIGNER.publicKey.export({ type: "spki", format: "pem" }).toString();
const REVIEWER = { ...OWNER, security: { twoFactorRequired: true, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: true } };
const FIXTURE = fileURLToPath(new URL("../fixtures/sample-plugin", import.meta.url));

describe("plugin isolation (C3.10)", () => {
  it("names a plugin that does not fit and keeps the rest bootable", () => {
    const bad = definePlugin({
      name: "future",
      version: "9.0.0",
      freeholder: "^9.0.0",
      license: "MIT",
      requires: ["core"],
    });
    const ok = definePlugin({
      name: "sample",
      version: "0.1.0",
      freeholder: ">=0.0.0",
      license: "MIT",
      requires: ["core"],
    });
    const isolated = isolatePlugins([ok, bad], ["core"]);
    expect(isolated.find((entry) => entry.manifest.name === "future")?.error).toMatch(
      /requires Freeholder/,
    );
    expect(isolated.find((entry) => entry.manifest.name === "sample")?.error).toBeUndefined();
  });
});

describe("importer contract (C3.21)", () => {
  it("refuses private origins and accepts a public https URL", () => {
    expect(() => assertPublicHttpUrl("http://127.0.0.1/wp-json")).toThrow(/not a public origin/);
    expect(() => assertPublicHttpUrl("https://example.com/blog")).not.toThrow();
  });
});

describe.runIf(hasDatabase)("plugin lifecycle", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await trustPublisherKey.call({ publisher: "Test publisher", publicKey: PUBLIC_KEY, fingerprint: publisherPublicKey(PUBLIC_KEY).keyId, confirmation: true }, REVIEWER);
  });
  afterAll(closeDb);

  it("installs from a directory, checks integrity, enables and uninstalls", async () => {
    const integrity = await hashDirectory(FIXTURE);
    const signed = signIntegrity(integrity, SIGNER.privateKey);
    const installed = await installPlugin.call(
      { path: FIXTURE, expectedIntegrity: integrity, signature: signed },
      OWNER,
    );
    expect(installed.status).toBe("installed");
    expect(installed.integrity).toBe(integrity);
    const enabled = await enablePlugin.call({ name: "sample" }, OWNER);
    expect(enabled.status).toBe("enabled");
    const disabled = await disablePlugin.call({ name: "sample", reason: "trying isolation" }, OWNER);
    expect(disabled.status).toBe("disabled");
    const listed = await listInstalledPlugins.call({}, OWNER);
    expect(listed).toHaveLength(1);
    const gone = await uninstallPlugin.call({ name: "sample", retention: "purge" }, OWNER);
    expect(gone.retention).toBe("purge");
    expect(await listInstalledPlugins.call({}, OWNER)).toHaveLength(0);
  });

  it("refuses a forged signature and treats an identical update as a retry", async () => {
    const integrity = await hashDirectory(FIXTURE);
    await expect(
      failure(
        installPlugin.call(
          { path: FIXTURE, signature: "sha256:deadbeef" },
          OWNER,
        ),
      ),
    ).resolves.toMatchObject({ code: "permission" });
    await installPlugin.call({ path: FIXTURE, expectedIntegrity: integrity, signature: signIntegrity(integrity, SIGNER.privateKey) }, REVIEWER);
    const updated = await updatePlugin.call({ path: FIXTURE, signature: signIntegrity(integrity, SIGNER.privateKey) }, REVIEWER);
    expect(updated.previousVersion).toBeNull();
    expect(await failure(rollbackPlugin.call({ name: "sample" }, REVIEWER))).toMatchObject({ code: "conflict" });
  });

  it("stores a registry URL", async () => {
    const registry = await addPluginRegistry.call(
      { name: "Official", url: "https://plugins.freeholder.ai/index.json", tier: "verified" },
      OWNER,
    );
    expect(registry.tier).toBe("verified");
    expect(await listPluginRegistries.call({}, OWNER)).toHaveLength(1);
  });

  it("caches a signed registry index and lists the catalog", async () => {
    const index: RegistryIndex = {
      registry: "Official",
      updated: "2026-08-18",
      plugins: [
        {
          name: "gift-registry",
          version: "0.1.0",
          tier: "verified",
          license: "Apache-2.0",
          permissions: ["contacts:read"],
          freeholder: ">=0.0.0",
          integrity: `sha256:${"a".repeat(64)}`,
          changelog: "Initial release.",
        },
      ],
    };
    const url = "https://plugins.freeholder.ai/index.json";
    await addPluginRegistry.call({ name: "Official", url, publisherKeyId: publisherPublicKey(PUBLIC_KEY).keyId }, REVIEWER);
    const signature = signRegistryIndex(index, url, SIGNER.privateKey);
    await cachePluginRegistry.call(
      {
        url: "https://plugins.freeholder.ai/index.json",
        index,
        signature,
      },
      OWNER,
    );
    expect(await listPluginCatalog.call({}, OWNER)).toHaveLength(1);
  });
});

describe.runIf(hasDatabase)("import studio ledger", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("walks discover → preview → commit → rollback", async () => {
    const started = await startImport.call(
      { origin: "https://example.com", kind: "wordpress-rest" },
      OWNER,
    );
    expect(started.status).toBe("discover");
    const previewed = await previewImport.call(
      {
        id: started.id,
        pages: [{ url: "https://example.com/about", slug: "about", title: "About" }],
      },
      OWNER,
    );
    expect(previewed.status).toBe("previewed");
    const committed = await commitImport.call({ id: started.id }, OWNER);
    expect(committed.status).toBe("committed");
    expect(await db().select().from(pages).where(eq(pages.slug, "about"))).toHaveLength(1);
    const reconciled = await reconcileImport.call(
      { id: started.id, counts: { pages: 1, media: 0, redirects: 0 } },
      OWNER,
    );
    expect(reconciled.status).toBe("reconciled");
    const published = await publishImport.call({ id: started.id }, OWNER);
    expect(published.status).toBe("published");
    const rolled = await rollbackImport.call({ id: started.id }, OWNER);
    expect(rolled.status).toBe("rolled_back");
    expect(await db().select().from(pages).where(eq(pages.slug, "about"))).toHaveLength(0);
  });

  it("refuses a private origin", async () => {
    const error = await failure(
      startImport.call({ origin: "http://192.168.0.10", kind: "html" }, OWNER),
    );
    expect(error.message).toMatch(/not a public origin/);
  });
});
