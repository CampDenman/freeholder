// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.01: visitor → localized page → form/chat → one contact → inbox/task →
// quote → contract → invoice → payment → timeline. Customer pay reuses C5.25
// (manual/offline). Consent-safe signup import is the existing
// tests/core/signup-contact-import.test.ts suite — Playwright cannot call
// services without booting the job graph. Adapter doubles for hosted
// settlement; this does not claim a live Stripe/PayPal charge.
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { closeDb, db } from "@/core/db";
import { forms } from "@/modules/forms/schema";
import { pages } from "@/modules/cms/schema";
import { contractTemplates, contractDocuments } from "@/modules/contracts/schema";
import { invoices } from "@/modules/invoicing/schema";
import { quotes } from "@/modules/quotes/schema";
import { customerInvoicePath, invoiceAccessToken } from "@/modules/invoicing/customer-tokens";
import { resetBrowserDatabase } from "./database";
import { seedC11Owner, useOwnerSession } from "./owner-session";

const VISITOR = {
  name: "Ada Journey",
  email: "ada-c11@example.test",
};

const BLOCKS = [
  {
    id: "c11-h1",
    type: "heading",
    props: { text: "Empieza una consulta", level: 1, align: "start" },
  },
  { id: "c11-form", type: "form", props: { formSlug: "c11-enquiry" } },
  { id: "c11-chat", type: "siteChat", props: {} },
];

test.describe("C11.01 visitor to paid", () => {
  let token: string;
  let templateId: string;

  test.beforeAll(async () => {
    token = await seedC11Owner();
    await db().insert(forms).values({
      slug: "c11-enquiry",
      name: "C11 enquiry",
      submitLabel: "Send enquiry",
      successMessage: "Enquiry received.",
      destination: "contact",
      fields: [
        { key: "name", label: "Your name", kind: "text", required: true },
        { key: "email", label: "Email", kind: "email", required: true },
      ],
    });
    await db().insert(pages).values([
      {
        slug: "c11-enquiry",
        locale: "en",
        title: "Start an enquiry",
        blocks: BLOCKS,
        status: "published",
        publishedAt: new Date(),
      },
      {
        slug: "c11-enquiry",
        locale: "es",
        title: "Empieza una consulta",
        blocks: BLOCKS,
        status: "published",
        publishedAt: new Date(),
      },
    ]);
    const [template] = await db()
      .insert(contractTemplates)
      .values({
        name: "C11 sitting terms",
        kind: "agreement",
        title: "Terms for {{customer_name}}",
        body: "The sitting is as quoted. {{customer_name}} agrees to the studio terms.",
      })
      .returning({ id: contractTemplates.id });
    templateId = template!.id;
  });

  test.afterAll(async () => {
    await resetBrowserDatabase();
    await closeDb();
  });

  test("walks visitor, one contact, quote, contract, invoice, payment and timeline", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180_000);
    await useOwnerSession(context, token);

    await test.step("localized public page, form and chat resolve one contact", async () => {
      await page.goto("/es/c11-enquiry");
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await expect(page.getByRole("heading", { name: "Empieza una consulta" })).toBeVisible();
      await page.waitForTimeout(3_100);
      await page.getByLabel("Your name").fill(VISITOR.name);
      await page.getByLabel("Email").fill(VISITOR.email);
      await page.getByRole("button", { name: "Send enquiry" }).click();
      await expect(page.getByText("Enquiry received.")).toBeVisible();

      const chat = page.locator("form").filter({ has: page.locator('input[name="kind"][value="chat"]') });
      await chat.locator('input[name="name"]').fill(VISITOR.name);
      await chat.locator('input[name="email"]').fill(VISITOR.email);
      await chat.locator('textarea[name="message"]').fill("Can we book a sitting next month?");
      await chat.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/chatted=1/);

      const people = await db().select().from(contacts).where(eq(contacts.email, VISITOR.email));
      expect(people).toHaveLength(1);
    });

    await test.step("inbox, task, quote, conversion, contract, invoice and payment", async () => {
      await page.goto("/admin/inbox");
      await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
      await expect(page.getByText(VISITOR.name)).toBeVisible();

      await page.goto("/admin/tasks");
      await page.getByLabel("What has to happen").fill("Quote the coastal sitting");
      await page.getByRole("button", { name: "Add it" }).click();
      await expect(page.getByText("Quote the coastal sitting")).toBeVisible();

      await page.goto("/admin/quotes");
      await page.locator('select[name="contactId"]').selectOption({ label: VISITOR.name });
      await page.getByLabel("What it is for").fill("Coastal sitting");
      await page.getByRole("button", { name: "Start it" }).click();
      await expect(page).toHaveURL(/\/admin\/quotes\/[0-9a-f-]+$/);
      await page.getByPlaceholder("What it covers").first().fill("Portrait sitting");
      await page.getByPlaceholder("Price").first().fill("200.00");
      await page.getByRole("button", { name: "Save the lines" }).click();
      await expect(page.getByText("Done.")).toBeVisible();

      const quoteId = new URL(page.url()).pathname.split("/").at(-1)!;
      await db()
        .update(quotes)
        .set({
          depositMinor: 5_000,
          conversionPlan: {
            project: true,
            contractTemplateId: templateId,
            deposit: true,
            balance: true,
            bookings: [],
          },
        })
        .where(eq(quotes.id, quoteId));

      await page.getByRole("button", { name: "Send it to them" }).click();
      await expect(page).toHaveURL(/saved=sent/);
      const [sent] = await db().select().from(quotes).where(eq(quotes.id, quoteId));
      expect(sent?.viewToken).toBeTruthy();

      const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
      try {
        const customerPage = await visitor.newPage();
        await customerPage.goto(`/portal/quotes/${sent!.viewToken}`);
        await customerPage.getByLabel("Your full name").fill(VISITOR.name);
        await customerPage.getByRole("button", { name: "Accept this quote" }).click();
        await expect(customerPage).toHaveURL(/\/portal\/quotes\/accepted/);

        await expect
          .poll(async () => (await db().select().from(invoices)).length, { timeout: 15_000 })
          .toBeGreaterThan(0);
        await expect
          .poll(async () => (await db().select().from(contractDocuments)).length, { timeout: 15_000 })
          .toBeGreaterThan(0);

        const [agreement] = await db().select().from(contractDocuments);
        await customerPage.goto(`/portal/agreements/${agreement!.signToken}`);
        await customerPage.locator('input[name="signerName"]').fill(VISITOR.name);
        await customerPage.getByRole("button", { name: "Sign it" }).click();
        await expect
          .poll(async () => (await db().select().from(contractDocuments))[0]?.status, { timeout: 15_000 })
          .toBe("signed");
      } finally {
        await visitor.close();
      }

      const drafts = await db().select().from(invoices);
      const deposit = drafts.find((row) => row.sourceType === "deposit") ?? drafts[0]!;
      await page.goto(`/admin/invoices/${deposit.id}`);
      await page.getByRole("button", { name: "Issue invoice" }).click();
      await expect(page).toHaveURL(/\?saved=issue/);
      await page.getByRole("button", { name: "Email payment link", exact: true }).click();
      await expect(page).toHaveURL(/\?saved=send(?:Preview)?$/);
      const [issued] = await db().select().from(invoices).where(eq(invoices.id, deposit.id));
      const path = customerInvoicePath(issued!.id, invoiceAccessToken(issued!));

      const payContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
      try {
        const customerPage = await payContext.newPage();
        await customerPage.goto(path);
        await customerPage.getByRole("button", { name: "Arrange offline payment" }).click();
        await expect(customerPage.getByText(/offline/i).first()).toBeVisible();
      } finally {
        await payContext.close();
      }

      await page.goto("/admin/payments");
      await page.getByLabel("Amount").first().fill("50.00");
      await page.getByLabel("How this payment was verified").fill("C11.01 cash counted against the deposit invoice.");
      await page.getByLabel("I confirm this money was received and the evidence is accurate.").check();
      await page.getByRole("button", { name: "Record payment" }).click();
      await expect(page.getByText("The payment ledger was updated.")).toBeVisible();
    });

    await test.step("timeline sits on the same contact", async () => {
      const [visitor] = await db()
        .select()
        .from(contacts)
        .where(eq(contacts.email, VISITOR.email));
      const types = (
        await db()
          .select()
          .from(timelineEvents)
          .where(eq(timelineEvents.contactId, visitor!.id))
      ).map((event) => event.eventType);
      expect(types).toEqual(
        expect.arrayContaining(["form.submitted", "quote.accepted", "invoice.sent"]),
      );
      await page.goto(`/admin/contacts/${visitor!.id}`);
      await expect(page.getByRole("heading", { name: VISITOR.name })).toBeVisible();
    });
  });
});
