// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.39: actual WebAuthn ceremony and bounded MCP administration, no mocked crypto.
import { expect as baseExpect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { closeDb, db } from "@/core/db";
import { eq } from "drizzle-orm";
import { auditLog } from "@/core/events/schema";
import { resetBrowserDatabase } from "./database";

const expect = baseExpect.configure({ timeout: 20000 });
const EMAIL = "passkey-owner@example.test";
const BOOTSTRAP = "browser-test-only-bootstrap-secret-32-characters";

test.describe("owner and coding agent launch", () => {
  test.beforeAll(resetBrowserDatabase);
  test.afterAll(async () => { await resetBrowserDatabase(); await closeDb(); });
  test("claims privately, creates a passkey, downloads recovery, signs in without a password and publishes through scoped MCP", async ({ page, context }) => {
    test.setTimeout(180000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } });
    const accessible = async () => {
      for (const theme of ["light", "dark"]) {
        await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
      }
    };
    try {
      const urls: string[] = []; page.on("request", request => urls.push(request.url()));
      await page.goto(`/setup#claim=${BOOTSTRAP}`);
      await expect(page).toHaveURL(/\/setup$/);
      await expect(page.locator('input[name="bootstrapSecret"]')).toHaveValue(BOOTSTRAP);
      expect(urls.some(url => url.includes(BOOTSTRAP))).toBe(false);
      await page.getByLabel("Email", { exact: true }).fill(EMAIL);
      await page.getByLabel("Password", { exact: true }).fill("long-fallback-password-for-recovery");
      await page.getByRole("button", { name: "Create owner account", exact: true }).click();
      await expect(page).toHaveURL(/\/setup\/security$/);
      await page.goto("/setup/business"); await expect(page).toHaveURL(/\/setup\/security$/);
      await accessible();
      await page.getByRole("button", { name: "Create a passkey", exact: true }).click();
      await expect(page.getByText("Save these recovery codes now. They will not be shown again.")).toBeVisible();
      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download recovery codes" }).click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe("freeholder-recovery-codes.txt");
      expect(await readFile((await download.path()), "utf8")).toMatch(/(?:[A-Z2-7]{4}-){3}[A-Z2-7]{4}/);
      await expect(page.getByRole("button", { name: "Continue to your business" })).toBeDisabled();
      await page.getByLabel("I have saved my recovery codes somewhere safe.").check();
      await page.getByRole("button", { name: "Continue to your business" }).click();
      await page.getByLabel("Business name").fill("Passkey Studio");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await page.getByRole("button", { name: "I don’t have an address to show" }).click();
      await page.getByRole("button", { name: "Finish setup" }).click();
      await page.goto("/admin");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await accessible();
      await page.getByLabel("Email", { exact: true }).first().fill(EMAIL);
      await page.getByRole("button", { name: "Sign in with a passkey", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/, { timeout: 30000 });
      await page.goto("/admin/connect");
      await accessible();
      await page.getByLabel("Connection name").fill("Replit website builder");
      await page.getByLabel("What can it do?").selectOption("website");
      await page.getByRole("button", { name: "Create connection", exact: true }).click();
      const tokenInput = page.getByLabel("Connection credential", { exact: true });
      await expect(tokenInput).toHaveValue(/^fh_/);
      const token = await tokenInput.inputValue();
      await page.getByRole("button", { name: "Test connection", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Your credential works");
      const rpc = async (method: string, params: unknown = {}) => {
        const response = await context.request.post("/api/mcp", { headers: { authorization: `Bearer ${token}` }, data: { jsonrpc: "2.0", id: randomUUID(), method, params } });
        expect(response.status()).toBe(200); return await response.json() as { error?: unknown; result: { tools: { name: string }[]; isError?: boolean; structuredContent: { result: { id: string } } } };
      };
      const tools = (await rpc("tools/list")).result.tools as { name: string }[];
      expect(tools.some(tool => tool.name === "cms_publishPage")).toBe(true);
      for (const name of ["apikeys_create", "contacts_list", "platform_applyUpdate", "invoicing_recordOfflineRefund"]) {
        expect(tools.some(tool => tool.name === name)).toBe(false);
        expect((await rpc("tools/call", { name, arguments: {} })).error).toBeTruthy();
      }
      const slug = `agent-proof-${randomUUID()}`;
      const created = await rpc("tools/call", { name: "cms_createPage", arguments: { title: "Agent published page", slug, blocks: [{ id: randomUUID(), type: "heading", props: { text: "Created through MCP", level: 1 } }] } });
      expect(created.result.isError).toBe(false);
      const id = created.result.structuredContent.result.id;
      const published = await rpc("tools/call", { name: "cms_publishPage", arguments: { id, published: true } });
      expect(published.result.isError).toBe(false);
      const audit = await db().select().from(auditLog).where(eq(auditLog.actor, "agent:Replit website builder"));
      expect(audit.map(row => row.action)).toEqual(expect.arrayContaining(["cms.createPage", "cms.publishPage"]));
      expect(JSON.stringify(audit).includes(token)).toBe(false);
      await page.goto(`/${slug}`); await expect(page.getByRole("heading", { name: "Created through MCP" })).toBeVisible();
      await page.goto("/admin/connect");
      await page.getByLabel("Connection name").fill("Lovable reader");
      await page.getByLabel("Your assistant").selectOption("lovable");
      await page.getByRole("button", { name: "Create connection", exact: true }).click();
      await expect(tokenInput).toHaveValue(/^fh_/);
      const readToken = await tokenInput.inputValue();
      const refused = await context.request.post("/api/mcp", { headers: { authorization: `Bearer ${readToken}` }, data: { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "cms_createPage", arguments: { title: "Forbidden", slug: "forbidden" } } } });
      const refusal = await refused.json() as { error?: unknown }; expect(refusal.error).toBeTruthy();
      await expect(page.getByText(/This connects Lovable’s chat/)).toBeVisible();
    } finally { await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }); }
  });
});
