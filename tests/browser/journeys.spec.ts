// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Chromium acceptance journeys for MASTER.md §43 C1.22. These prove the
// browser-facing seams together: Server Actions, redirects, session cookies,
// autosave, public rendering, JSON-RPC and password recovery.
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { desc, eq } from "drizzle-orm";
import { passwordResets } from "@/core/auth/schema";
import { totpCode } from "@/core/auth/two-factor-crypto";
import { contacts } from "@/core/contacts/schema";
import { closeDb, db } from "@/core/db";
import { invoices, payments, refunds, taxCategories } from "@/modules/invoicing/schema";
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

    await test.step("role guidance starts, skips, resumes, resets and relaunches in context", async () => {
      const ownerGuide = page.locator('[data-guidance-flow="core.owner-first-win"]');
      await expect(ownerGuide.getByRole("heading", { name: "Win with the whole business loop" })).toBeVisible();
      await expect(ownerGuide.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "0 of 3 tasks complete",
      );
      await ownerGuide.getByRole("button", { name: "Start guide" }).click();
      await expect(ownerGuide.getByRole("button", { name: "Skip for now" })).toBeVisible();

      await page.goto("/admin/invitations");
      await page.getByRole("link", { name: "Guided help" }).click();
      await expect(page).toHaveURL(/\/admin\/guidance\?flow=core\.administrator-first-win/);
      const adminGuide = page.locator('[data-guidance-flow="core.administrator-first-win"]');
      await expect(adminGuide.getByRole("heading", { name: "Run the workspace" })).toBeVisible();
      await adminGuide.getByRole("button", { name: "Skip for now" }).click();
      await expect(adminGuide.getByText("Skipped for now")).toBeVisible();
      await adminGuide.getByRole("button", { name: "Resume guide" }).click();
      await expect(adminGuide.getByRole("button", { name: "Skip for now" })).toBeVisible();
      await adminGuide.getByRole("button", { name: "Reset guide" }).click();
      await expect(adminGuide.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "0 of 2 tasks complete",
      );
      await page.goto("/admin");
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

    await test.step("offline payment and refund use the accessible shared money console", async () => {
      // Seed only the issued-invoice prerequisite. The browser still drives the
      // real Server Action and invoicing services for both money movements.
      const contactId = randomUUID();
      const invoiceId = randomUUID();
      await db().insert(contacts).values({
        id: contactId,
        name: "Payment Journey",
        email: "payment-journey@example.test",
      });
      await db().insert(invoices).values({
        id: invoiceId,
        contactId,
        number: "INV-JOURNEY-001",
        idempotencyKey: "browser-payment-invoice",
        requestHash: createHash("sha256").update("browser-payment-invoice").digest("hex"),
        status: "sent",
        currency: "CAD",
        subtotalMinor: 10_000,
        discountMinor: 0,
        shippingMinor: 0,
        taxMinor: 0,
        totalMinor: 10_000,
        paidMinor: 0,
        refundedMinor: 0,
        issuedAt: new Date(),
      });

      await page.goto("/admin/payments");
      await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
      await expect(page.getByText("manual", { exact: true })).toBeVisible();
      await page.getByLabel("Amount").first().fill("100.00");
      await page.getByLabel("How this payment was verified").fill("Matched to the browser acceptance bank statement.");
      await page.getByLabel("I confirm this money was received and the evidence is accurate.").check();
      await page.getByRole("button", { name: "Record payment" }).click();
      await expect(page).toHaveURL(/\/admin\/payments\?status=record/);
      await expect(page.getByText("The payment ledger was updated.")).toBeVisible();
      const [settled] = await db().select().from(payments).where(eq(payments.invoiceId, invoiceId));
      expect(settled).toMatchObject({ provider: "manual", status: "succeeded", amountMinor: 10_000 });

      await page.getByLabel("Amount", { exact: true }).fill("5.00");
      await page.getByLabel("Refund reason").fill("Acceptance fixture partial refund");
      await page.getByLabel("I confirm this refund amount and understand it moves real provider money when hosted.").check();
      await page.getByRole("button", { name: "Submit refund" }).click();
      await expect(page).toHaveURL(/\/admin\/payments\?status=refund/);
      expect((await db().select().from(refunds).where(eq(refunds.paymentId, settled!.id)))[0]).toMatchObject({ provider: "manual", status: "succeeded", amountMinor: 500 });

      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations).toEqual([]);
    });

    await test.step("admin invoices create and issue a draft, then install a tax starter", async () => {
      await page.goto("/admin/invoices/new");
      await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
      await page.getByLabel("Contact").selectOption({ label: "Payment Journey · payment-journey@example.test" });
      await page.getByLabel("Line 1 description").fill("Discovery session");
      await page.getByLabel("Line 1 unit amount").fill("50.00");
      await page.getByRole("button", { name: "Create draft invoice" }).click();
      await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]+\?saved=created$/);
      await expect(page.getByText("The draft invoice was created.")).toBeVisible();
      await page.getByRole("button", { name: "Issue invoice" }).click();
      await expect(page).toHaveURL(/\?saved=issue$/);
      await expect(page.getByText("The invoice was issued.")).toBeVisible();
      await expect(page.getByText(/^INV-/)).toBeVisible();

      await page.goto("/admin/invoices/tax");
      await expect(page.getByRole("heading", { name: "Tax setup" })).toBeVisible();
      await page.getByRole("button", { name: "Install Alberta GST/HST" }).click();
      await expect(page).toHaveURL(/\/admin\/invoices\/tax\?saved=install$/);
      await expect(page.getByText("The tax starter was installed in monitoring mode.")).toBeVisible();
      await expect(page.getByText("Installed").first()).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    });

    await test.step("admin catalog creates, activates and describes a real service product", async () => {
      const [taxCategory] = await db()
        .insert(taxCategories)
        .values({ code: "journey_standard", name: "Journey standard taxable" })
        .returning();
      if (!taxCategory) throw new Error("The catalog journey tax category was not created.");

      await page.goto("/admin/products/new");
      await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
      await page.getByLabel("Name").fill("Portrait session");
      await page.getByLabel("Product address").fill("portrait-session");
      await page.getByLabel("Product kind").selectOption("service");
      await page.getByLabel("Tax category").selectOption(taxCategory.id);
      await page.getByRole("button", { name: "Create draft product" }).click();
      await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+\?saved=created$/);
      await expect(page.getByRole("heading", { name: "Portrait session" })).toBeVisible();
      await expect(page.getByText("The draft product was created.")).toBeVisible();

      await page.getByRole("button", { name: "Activate product" }).click();
      await expect(page).toHaveURL(/\?saved=activate$/);
      await expect(page.getByText("The product is active.")).toBeVisible();

      await page.getByLabel("Duration in minutes").fill("90");
      await page.getByLabel("Where it happens").selectOption("in_person");
      await page.getByRole("button", { name: "Save service offering" }).click();
      await expect(page.getByText("The service offering was saved.")).toBeVisible();

      await page.getByLabel("Option type name").fill("Size");
      await page.getByLabel("Option type code").fill("size");
      await page.getByRole("button", { name: "Create option type" }).click();
      await expect(page.getByText("The option type was created.")).toBeVisible();
      await page.getByLabel("Value name").fill("Small");
      await page.getByLabel("SKU fragment").fill("s");
      await page.getByRole("button", { name: "Add value" }).click();
      await expect(page.getByText("The option value was added.")).toBeVisible();
      await page.getByRole("button", { name: "Use on this product" }).click();
      await expect(page.getByText("The option type was assigned to this product.")).toBeVisible();
      await page.getByRole("checkbox", { name: /Small/ }).check();
      await page.getByRole("button", { name: "Save selected values" }).click();
      await expect(page.getByText("The selected option values were saved.")).toBeVisible();
      await page.getByRole("button", { name: "Apply variant matrix" }).click();
      await expect(page.getByText("The variant matrix was reconciled.")).toBeVisible();
      await expect(page.getByText("portrait-session-s")).toBeVisible();

      await page.getByRole("button", { name: "Add a block" }).click();
      await page.getByRole("button", { name: "Heading", exact: true }).click();
      await page.getByLabel("Text").fill("A thoughtful portrait experience");
      await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
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
      await page.getByLabel("Size").selectOption("1");
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
      await page.locator("#lifecycleStage").selectOption("prospect");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Saved.")).toBeVisible();
    });

    await test.step("guidance completes only after the real business outcomes", async () => {
      await page.goto("/admin");
      const ownerGuide = page.locator('[data-guidance-flow="core.owner-first-win"]');
      await expect(ownerGuide.locator("header").getByText("Completed")).toBeVisible();
      await expect(ownerGuide.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        "3 of 3 tasks complete",
      );
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
