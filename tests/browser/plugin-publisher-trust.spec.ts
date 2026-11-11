// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.42: actual Ed25519 signatures, owner forms, rotation and refusal.
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/core/db";
import { sessions } from "@/core/auth/schema";
import { THEME_COOKIE } from "@/core/design/theme";
import { hashDirectory, publisherPublicKey, signIntegrity } from "@/core/plugins/integrity";
import { signRegistryIndex, type RegistryIndex } from "@/core/plugins/registry";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";
import { resetBrowserDatabase } from "./database";

test("the owner trusts, installs, rotates and revokes a publisher key", async ({ page, context }) => {
  test.setTimeout(180_000);
  const old = generateKeyPairSync("ed25519"); const next = generateKeyPairSync("ed25519");
  const directories: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const publicKey = (key: typeof old) => key.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = (key: typeof old) => publisherPublicKey(publicKey(key)).keyId;
  async function artifact(version: string, key: typeof old) {
    const path = await mkdtemp(join(tmpdir(), "freeholder-browser-publisher-")); directories.push(path);
    await writeFile(join(path, "plugin.json"), JSON.stringify({ name: "sample", version, license: "Apache-2.0", freeholder: ">=0.0.0", permissions: version === "0.1.0" ? ["contacts:read"] : ["contacts:read", "network:external"] }));
    await writeFile(join(path, "index.js"), `// browser fixture ${version}`);
    const integrity = await hashDirectory(path);
    return { path, integrity, signature: signIntegrity(integrity, key.privateKey) };
  }
  try {
    await useOwnerSession(context, await seedC11Owner("Publisher key qualification"));
    await page.goto("/admin/plugins");
    async function trust(key: typeof old) {
      await page.getByLabel("Publisher name", { exact: true }).fill("Browser publisher");
      await page.getByLabel("Public signing key (PEM)", { exact: true }).fill(publicKey(key));
      await page.getByLabel("SHA-256 public-key fingerprint", { exact: true }).fill(keyId(key));
      await page.getByLabel("I checked this fingerprint with the publisher outside this plugin or catalogue.", { exact: true }).check();
      await page.getByRole("button", { name: "Trust publisher key", exact: true }).click();
      await expect(page.locator(`li[data-publisher-key-id="${keyId(key)}"]`)).toBeVisible();
    }
    await trust(old);

    const first = await artifact("0.1.0", old); const second = await artifact("0.2.0", next);
    await page.getByLabel("Plugin folder", { exact: true }).fill(first.path);
    await page.locator("#install-signature").fill(first.signature);
    await page.getByRole("button", { name: "Install from a folder", exact: true }).click();
    const plugin = page.locator('li[data-plugin-name="sample"]');
    await expect(plugin.getByText("0.1.0", { exact: true })).toBeVisible();
    await expect(plugin.getByText("Does not declare outbound network access", { exact: true })).toBeVisible();
    await plugin.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(plugin.getByRole("alert")).toContainText("Review its permissions");
    const review = page.locator('li[data-plugin-permissions="sample"]');
    async function approvePermissions() {
      await review.getByLabel("I approve exactly the permissions listed above.", { exact: true }).check();
      await review.getByRole("button", { name: "Approve permissions", exact: true }).click();
      await expect(review.getByText("Permissions approved", { exact: true })).toBeVisible();
    }
    await approvePermissions();
    await plugin.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(plugin.getByText("Enabled", { exact: true })).toBeVisible();

    const url = "https://publisher.example/index.json";
    const index: RegistryIndex = { registry: "Browser publisher", updated: "2026-11-10", plugins: [{ name: "sample", version: "0.1.0", tier: "community", license: "Apache-2.0", freeholder: ">=0.0.0", permissions: ["contacts:read"], integrity: first.integrity, changelog: "Browser fixture." }] };
    await page.getByLabel("Registry name", { exact: true }).fill("Browser registry");
    await page.getByLabel("Registry URL", { exact: true }).fill(url);
    await page.locator("#registry-publisher-key").selectOption(keyId(old));
    await page.getByRole("button", { name: "Add registry", exact: true }).click();
    const registry = page.locator("li[data-plugin-registry-id]").filter({ hasText: "Browser registry" });
    await expect(registry).toBeVisible();
    async function cache(key: typeof old) {
      await registry.getByLabel("Catalogue index (JSON)", { exact: true }).fill(JSON.stringify(index));
      await registry.getByLabel("Publisher signature", { exact: true }).fill(signRegistryIndex(index, url, key.privateKey));
      await registry.getByRole("button", { name: "Verify and save catalogue", exact: true }).click();
      await expect(page.locator('li[data-catalog-plugin="sample"]')).toBeVisible();
    }
    await cache(old);

    await trust(next);
    await plugin.getByLabel("Folder to update from", { exact: true }).fill(second.path);
    await plugin.getByLabel("Publisher signature", { exact: true }).fill(second.signature);
    await plugin.getByRole("button", { name: "Update", exact: true }).click();
    await expect(plugin.getByText("0.2.0", { exact: true })).toBeVisible();
    await expect(plugin.getByText("Declares outbound network access", { exact: true })).toBeVisible();
    await expect(review.getByText("Review required", { exact: true })).toBeVisible();
    await expect(review.getByLabel("I approve exactly the permissions listed above.", { exact: true })).not.toBeChecked();
    await expect(plugin.getByText("Disabled", { exact: true })).toBeVisible();
    await approvePermissions();
    await plugin.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(plugin.getByText("Enabled", { exact: true })).toBeVisible();
    await registry.getByLabel("Registry signing key", { exact: true }).selectOption(keyId(next));
    await registry.getByRole("button", { name: "Pin registry key", exact: true }).click();
    await expect(page.locator('li[data-catalog-plugin="sample"]')).toHaveCount(0);
    index.plugins[0]!.version = "0.2.0";
    index.plugins[0]!.integrity = second.integrity;
    index.plugins[0]!.permissions = ["contacts:read", "network:external"];
    await cache(next);

    const oldKey = page.locator(`li[data-publisher-key-id="${keyId(old)}"]`);
    await oldKey.getByRole("checkbox").check();
    await oldKey.getByRole("button", { name: "Revoke key", exact: true }).click();
    await expect(oldKey.getByText("Revoked", { exact: true }).first()).toBeVisible();
    await plugin.getByRole("button", { name: "Roll back", exact: true }).click();
    await expect(plugin.getByRole("alert")).toContainText("whether the publisher key was revoked");
    await expect(plugin.getByText("0.2.0", { exact: true })).toBeVisible();
    await expect(plugin.getByText("Declares outbound network access", { exact: true })).toBeVisible();
    const newKey = page.locator(`li[data-publisher-key-id="${keyId(next)}"]`);
    await newKey.getByRole("checkbox").check();
    await newKey.getByRole("button", { name: "Revoke key", exact: true }).click();
    await expect(plugin.getByText("Disabled", { exact: true })).toBeVisible();
    await expect(page.locator('li[data-catalog-plugin="sample"]')).toHaveCount(0);
    await plugin.getByRole("button", { name: "Enable", exact: true }).click();
    await expect(plugin.getByRole("alert")).toContainText("whether the publisher key was revoked");

    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByLabel("Public signing key (PEM)", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(page.getByLabel("SHA-256 public-key fingerprint", { exact: true })).toBeFocused();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    }
    await page.setViewportSize({ width: 320, height: 900 });
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
    await db().update(sessions).set({ stepUpAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(sessions.userId, "00000000-0000-4000-8000-000000000001"));
    await page.reload();
    await expect(page.getByRole("button", { name: "Trust publisher key", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Confirm your identity to change publisher trust.", exact: true })).toHaveAttribute("href", "/security/verify?returnTo=/admin/plugins");
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(directories.map(path => rm(path, { recursive: true, force: true })));
  }
});

test.afterAll(async () => { await resetBrowserDatabase(); await closeDb(); });
