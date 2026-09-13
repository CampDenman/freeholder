// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.01: anonymous visitor → localized page → form/chat → one contact →
// inbox/task → quote → quotes.setConversion → contract → invoice → payment →
// timeline/report. Customer pay reuses C5.25 (manual/offline). Consent-safe
// signup import is the existing tests/core/signup-contact-import.test.ts
// suite — Playwright cannot call services without booting the job graph.
// Adapter doubles for hosted settlement; this does not claim a live
// Stripe/PayPal charge.
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken } from "@/core/http/csrf";
import { contacts, timelineEvents } from "@/core/contacts/schema";
import { closeDb, db } from "@/core/db";
import { forms } from "@/modules/forms/schema";
import { pages } from "@/modules/cms/schema";
import { contractTemplates, contractDocuments } from "@/modules/contracts/schema";
import { invoices } from "@/modules/invoicing/schema";
import { quotes } from "@/modules/quotes/schema";
import { customerInvoicePath, invoiceAccessToken } from "@/modules/invoicing/customer-tokens";
import { resetBrowserDatabase } from "./database";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const API_BASE = "/api/v1";

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

async function ownerService(name: string, sessionToken: string, body: unknown): Promise<Response> {
  const csrf = issueCsrfToken();
  return fetch(`${C11_BASE_URL}${API_BASE}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; ${CSRF_COOKIE}=${encodeURIComponent(csrf)}`,
      [CSRF_HEADER]: csrf,
    },
    body: JSON.stringify(body),
  });
}

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

  test("walks visitor, one contact, quote, contract, invoice, payment, timeline and report", async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180_000);

    await test.step("localized public page, form and chat resolve one contact as a visitor", async () => {
      const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
      try {
        expect(await visitor.cookies()).toEqual([]);
        const publicPage = await visitor.newPage();
        await publicPage.goto("/es/c11-enquiry");
        await expect(publicPage.locator("html")).toHaveAttribute("lang", "es");
        await expect(publicPage.getByRole("heading", { name: "Empieza una consulta" })).toBeVisible();
        await publicPage.waitForTimeout(3_100);
        await publicPage.getByLabel("Your name").fill(VISITOR.name);
        await publicPage.getByLabel("Email").fill(VISITOR.email);
        await publicPage.getByRole("button", { name: "Send enquiry" }).click();
        await expect(publicPage.getByText("Enquiry received.")).toBeVisible();

        const chat = publicPage
          .locator("form")
          .filter({ has: publicPage.locator('input[name="kind"][value="chat"]') });
        await chat.locator('input[name="name"]').fill(VISITOR.name);
        await chat.locator('input[name="email"]').fill(VISITOR.email);
        await chat.locator('textarea[name="message"]').fill("Can we book a sitting next month?");
        await chat.locator('button[type="submit"]').click();
        await expect(publicPage).toHaveURL(/chatted=1/);

        const people = await db().select().from(contacts).where(eq(contacts.email, VISITOR.email));
        expect(people).toHaveLength(1);
      } finally {
        await visitor.close();
      }
    });

    await useOwnerSession(context, token);

    await test.step("inbox, owner follow-up task, quote, conversion, contract, invoice and payment", async () => {
      await page.goto("/admin/inbox");
      await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
      await expect(page.getByText(VISITOR.name)).toBeVisible();

      // Tasks have no contactId; this is the owner's follow-up, not a row
      // produced by the enquiry itself.
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
      const conversion = await ownerService("quotes.setConversion", token, {
        id: quoteId,
        plan: {
          project: true,
          contractTemplateId: templateId,
          deposit: true,
          balance: true,
          bookings: [],
        },
      });
      expect(conversion.ok, await conversion.text()).toBe(true);

      await page.getByRole("button", { name: "Send it to them" }).click();
      await expect(page).toHaveURL(/saved=sent/);
      const [sent] = await db().select().from(quotes).where(eq(quotes.id, quoteId));
      expect(sent?.viewToken).toBeTruthy();
      expect(sent?.conversionPlan).toEqual(
        expect.objectContaining({ contractTemplateId: templateId, deposit: true, balance: true }),
      );

      const visitor = await browser.newContext({ baseURL: C11_BASE_URL });
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
      const payable = drafts.find((row) => row.sourceType === "quote") ?? drafts[0]!;
      await page.goto(`/admin/invoices/${payable.id}`);
      await page.getByRole("button", { name: "Issue invoice" }).click();
      await expect(page).toHaveURL(/\?saved=issue/);
      await page.getByRole("button", { name: "Email payment link", exact: true }).click();
      await expect(page).toHaveURL(/\?saved=send(?:Preview)?$/);
      const [issued] = await db().select().from(invoices).where(eq(invoices.id, payable.id));
      const path = customerInvoicePath(issued!.id, invoiceAccessToken(issued!));

      const payContext = await browser.newContext({ baseURL: C11_BASE_URL });
      try {
        const customerPage = await payContext.newPage();
        await customerPage.goto(path);
        await customerPage.getByRole("button", { name: "Arrange offline payment" }).click();
        await expect(customerPage.getByText(/offline/i).first()).toBeVisible();
      } finally {
        await payContext.close();
      }

      const amount = (issued!.totalMinor / 100).toFixed(2);
      await page.goto("/admin/payments");
      await page.getByLabel("Invoice and outstanding balance", { exact: true }).first().selectOption(issued!.id);
      await page.getByLabel("Amount", { exact: true }).first().fill(amount);
      await page.getByLabel("How this payment was verified").fill("C11.01 cash counted against the converted invoice.");
      await page.getByLabel("I confirm this money was received and the evidence is accurate.").check();
      await page.getByRole("button", { name: "Record payment" }).click();
      await expect(page.getByText("The payment ledger was updated.")).toBeVisible();
      const settled = (await db().select().from(invoices).where(eq(invoices.id, issued!.id)))[0];
      expect(settled?.paidMinor).toBe(issued!.totalMinor);
      expect(settled?.paidAt).toBeTruthy();
    });

    await test.step("timeline copy and reports after pay", async () => {
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
      await expect(page.getByText("Form submitted")).toBeVisible();
      await expect(page.getByText("Quote accepted")).toBeVisible();
      await expect(page.getByText("Invoice sent")).toBeVisible();

      const report = await fetch(`${C11_BASE_URL}${API_BASE}/reports.revenue?days=90`, {
        headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      });
      expect(report.ok, await report.clone().text()).toBe(true);
      const body = (await report.json()) as { months?: { amountMinor: number; currency: string }[] };
      expect(body.months?.length ?? 0).toBeGreaterThan(0);
      expect(body.months!.some((month) => month.amountMinor > 0)).toBe(true);

      await page.goto("/admin/reports");
      await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
      await expect(page.getByText("Revenue").first()).toBeVisible();
    });
  });
});
