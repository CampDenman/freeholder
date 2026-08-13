// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Chromium acceptance journeys for MASTER.md §43 C1.22. These prove the
// browser-facing seams together: Server Actions, redirects, session cookies,
// autosave, public rendering, JSON-RPC and password recovery.
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { desc, eq } from "drizzle-orm";
import { passwordResets } from "@/core/auth/schema";
import { totpCode } from "@/core/auth/two-factor-crypto";
import { closeDb, db } from "@/core/db";
import { resetBrowserDatabase } from "./database";

const OWNER_EMAIL = "owner-journey@example.test";
const OLD_PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "river lantern copper meadow";
const RESET_TOKEN = "journey-known-password-reset-token";

async function passwordSignIn(page: Page, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("real-browser product journeys", () => {
  test.beforeAll(resetBrowserDatabase);
  test.afterAll(async () => {
    // Later CI gates share this database; never leak browser fixture state.
    await resetBrowserDatabase();
    await closeDb();
  });

  test("covers setup, auth, editing, publishing, forms, contacts, translations, API keys, MCP and recovery", async ({ page }) => {
    test.setTimeout(300_000);
    let totpSecret = "";
    let recoveryCode = "";
    let formId = "";

    await test.step("first-boot setup works before owner 2FA exists", async () => {
      await page.goto("/setup");
      await page.getByLabel("Email").fill(OWNER_EMAIL);
      await page.getByLabel("Password").fill(OLD_PASSWORD);
      await page.getByRole("button", { name: "Create owner account" }).click();
      await expect(page).toHaveURL(/\/setup\/business$/);

      await page.getByLabel("Business name").fill("Journey Studio");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/\/setup\/location$/);

      await page.getByLabel("Street").fill("210 Fifth Street");
      await page.getByLabel("City or town").fill("Courtenay");
      await page.getByLabel("State, province or county").fill("BC");
      await page.getByLabel("Postal code").fill("V9N 1A1");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/\/setup\/done$/);

      await page.getByRole("button", { name: "Finish setup" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByText("Journey Studio").first()).toBeVisible();

      // The wizard is now locked, and privileged work moves to 2FA enrolment.
      await page.goto("/setup");
      await expect(page).toHaveURL(/\/$/);
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/security\?required=1$/);
    });

    await test.step("owner enrols TOTP and receives recovery credentials", async () => {
      await page.getByRole("button", { name: "Set up authenticator app" }).click();
      const secret = page.locator("p code").first();
      await expect(secret).toBeVisible();
      totpSecret = (await secret.textContent())?.trim() ?? "";
      expect(totpSecret).toMatch(/^[A-Z2-7]+$/);

      const code = totpCode(totpSecret, Math.floor(Date.now() / 30_000));
      await page.getByLabel("Verification code").fill(code);
      await page.getByRole("button", { name: "Confirm and turn on" }).click();
      await expect(
        page.getByText("Save these recovery codes now. They will not be shown again."),
      ).toBeVisible();
      const shownCodes = await page.locator("code").allTextContents();
      recoveryCode = shownCodes.find((value) => /^(?:[A-Z2-7]{4}-){3}[A-Z2-7]{4}$/.test(value.trim()))?.trim() ?? "";
      expect(recoveryCode).toMatch(/^(?:[A-Z2-7]{4}-){3}[A-Z2-7]{4}$/);

      await page.goto("/admin");
      await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    });

    await test.step("password and TOTP login take the real redirect path", async () => {
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);

      await passwordSignIn(page, "definitely the wrong password");
      await expect(page.getByText("Wrong email or password.")).toBeVisible();

      await page.getByLabel("Password").fill(OLD_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/login\/verify$/);
      // Enrolment consumed the current step; the verifier accepts the next
      // step in its standard ±1 clock window and still proves replay defence.
      const nextCode = totpCode(totpSecret, Math.floor(Date.now() / 30_000) + 1);
      await page.getByLabel("Verification code").fill(nextCode);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(/\/admin$/);
    });

    await test.step("form builder creates a public form", async () => {
      await page.goto("/admin/forms/new");
      await page.getByLabel("Form name").fill("Journey enquiry");
      await page.getByLabel("Web address").fill("journey-enquiry");
      await page.getByLabel("Button text").fill("Send journey");
      await page.getByLabel("What to say afterwards").fill("Journey received.");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page).toHaveURL(/\/admin\/forms\/[0-9a-f-]+\/edit$/);
      formId = new URL(page.url()).pathname.split("/")[3] ?? "";
      expect(formId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { name: "Journey enquiry" })).toBeVisible();
    });

    await test.step("block editor autosaves and publishing reaches the storefront", async () => {
      await page.goto("/admin/pages/new");
      await page.getByLabel("Title").fill("Journey Page");
      await page.getByLabel("Web address").fill("journey");
      await page.getByRole("button", { name: "Create page" }).click();
      await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]+$/);

      await page.getByRole("button", { name: "Add a block" }).click();
      await page.getByRole("button", { name: "Heading", exact: true }).click();
      await page.getByLabel("Text").fill("Start a journey");
      await page.getByRole("button", { name: "Add a block" }).click();
      await page.getByRole("button", { name: "Form", exact: true }).click();
      await page.getByLabel("formSlug").fill("journey-enquiry");
      await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });

      await page.getByRole("button", { name: "Publish" }).click();
      await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
      await page.goto("/journey");
      await expect(page.getByRole("heading", { name: "Start a journey" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Send journey" })).toBeVisible();
    });

    await test.step("public form creates a visible submission and contact", async () => {
      // Let the signed form timestamp clear its intentional three-second trap.
      await page.waitForTimeout(3_100);
      await page.getByLabel("Your name").fill("Public Journey");
      await page.getByLabel("Email").fill("public-journey@example.test");
      await page.getByRole("button", { name: "Send journey" }).click();
      await expect(page).toHaveURL(/\/journey\?sent=journey-enquiry$/);
      await expect(page.getByText("Journey received.")).toBeVisible();

      await page.goto(`/admin/forms/${formId}`);
      await expect(page.getByText("Public Journey")).toBeVisible();
      await expect(page.getByText("public-journey@example.test")).toBeVisible();
      await expect(page.getByRole("link", { name: "Open contact" })).toBeVisible();
    });

    await test.step("contact entry uses the shared admin record", async () => {
      await page.goto("/admin/contacts/new");
      await page.getByLabel("Name").fill("Ada Journey");
      await page.getByLabel("Email").fill("ada-journey@example.test");
      await page.getByLabel("Phone").fill("+1 250 555 0199");
      await page.getByLabel("Preferred language").fill("fr-CA");
      await page.getByLabel("Time zone").fill("America/Vancouver");
      await page.getByLabel("Country").fill("CA");
      await page.getByRole("button", { name: "Add contact" }).click();
      await expect(page).toHaveURL(/\/admin\/contacts\/[0-9a-f-]+$/);
      await expect(page.getByRole("heading", { name: "Ada Journey" })).toBeVisible();
      await expect(page.getByLabel("Email")).toHaveValue("ada-journey@example.test");
    });

    await test.step("reviewed translation replaces source words on the locale route", async () => {
      await page.goto("/admin/translations");
      const row = page.getByRole("row", { name: /Journey Page/ });
      await row.getByRole("link", { name: "Translate" }).click();
      await page.locator('input[name="t.title"]').fill("Page parcours");
      await page.locator('input[name="t.0.props.text"]').fill("Commencez un parcours");
      await page
        .getByRole("checkbox", {
          name: "Checked by a person — show this to visitors",
        })
        .check();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(
        page.getByText("Saved. Your public site uses these straight away."),
      ).toBeVisible();

      await page.goto("/fr-CA/journey");
      await expect(
        page.getByRole("heading", { name: "Commencez un parcours" }),
      ).toBeVisible();
    });

    let apiKey = "";
    await test.step("owner mints a least-privilege API key", async () => {
      await page.goto("/admin/settings");
      await page.locator("#key-name").fill("Journey MCP");
      await page.locator("#access-contacts").selectOption("full");
      await page.getByRole("button", { name: "Create key" }).click();
      const token = page
        .locator("code")
        .filter({ hasText: /^fh_live_[A-Za-z0-9_-]{43}$/ });
      await expect(token).toBeVisible();
      apiKey = (await token.textContent())?.trim() ?? "";
      expect(apiKey).toMatch(/^fh_live_[A-Za-z0-9_-]+$/);
    });

    await test.step("that key discovers and invokes the live MCP server", async () => {
      const headers = { authorization: `Bearer ${apiKey}` };
      const listed = await page.request.post("/api/mcp", {
        headers,
        data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      });
      expect(listed.ok()).toBe(true);
      const listBody = (await listed.json()) as {
        result: { tools: Array<{ name: string }> };
      };
      expect(listBody.result.tools.map((tool) => tool.name)).toContain("contacts_list");
      expect(listBody.result.tools.map((tool) => tool.name)).not.toContain("media_trash");

      const called = await page.request.post("/api/mcp", {
        headers,
        data: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "contacts_list",
            arguments: { search: "Ada Journey" },
          },
        },
      });
      expect(called.ok()).toBe(true);
      const callBody = (await called.json()) as {
        result: {
          isError: boolean;
          structuredContent: { result: { rows: Array<{ email: string }> } };
        };
      };
      expect(callBody.result.isError).toBe(false);
      expect(callBody.result.structuredContent.result.rows).toEqual([
        expect.objectContaining({ email: "ada-journey@example.test" }),
      ]);
    });

    await test.step("password recovery revokes the session and recovery code restores access", async () => {
      await page.goto("/forgot");
      await page.getByLabel("Email").fill(OWNER_EMAIL);
      await page.getByRole("button", { name: "Send the link" }).click();
      await expect(
        page.getByText(/If that address has an account, a reset link is on its way/),
      ).toBeVisible();

      const [pending] = await db()
        .select({ id: passwordResets.id })
        .from(passwordResets)
        .orderBy(desc(passwordResets.createdAt))
        .limit(1);
      if (!pending) throw new Error("The forgot-password journey did not create a reset.");
      await db()
        .update(passwordResets)
        .set({
          tokenHash: createHash("sha256").update(RESET_TOKEN).digest("hex"),
        })
        .where(eq(passwordResets.id, pending.id));

      await page.goto(`/reset?token=${encodeURIComponent(RESET_TOKEN)}`);
      await page.getByLabel("New password").fill(NEW_PASSWORD);
      await page
        .getByRole("button", { name: "Set password and sign out everywhere" })
        .click();
      await expect(page.getByText("Password set. Sign in with it now.")).toBeVisible();

      await page.getByRole("link", { name: "Back to sign in" }).click();
      await page.getByLabel("Email").fill(OWNER_EMAIL);
      await page.getByLabel("Password").fill(OLD_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText("Wrong email or password.")).toBeVisible();

      await page.getByLabel("Password").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/login\/verify$/);
      await page.getByLabel("Verification code").fill(recoveryCode);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    });
  });
});
