// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import {
  demoHandlerInputSchema,
  demoLoadResultSchema,
  demoPurgeResultSchema,
  demoVerifyResultSchema,
} from "@/core/onboarding/contract";
import { requireDemoHandlerRun } from "@/core/demo/handler";
import { contacts } from "@/core/contacts/schema";
import { defineService, getService, ServiceError } from "@/core/service";
import { invoices } from "./schema";

const CONTRIBUTION = { key: "invoicing.demo-invoice", version: 1 } as const;
const TITLES = {
  en: "[Demo] Overdue sitting balance",
  fr: "[Demo] Solde de séance en retard",
  es: "[Demo] Saldo de sesión vencido",
} as const;

export const loadDemoInvoice = defineService({
  name: "invoicing.loadDemoFixture",
  summary: "Raise a marked overdue invoice for the demo past-due client.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "load");
    const [person] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, "past-due@demo.freeholder.test"))
      .limit(1);
    if (!person) throw new ServiceError("conflict", "Demo invoice needs the past-due contact.");
    const description = TITLES[input.locale as keyof typeof TITLES] ?? TITLES.en;
    const dueAt = new Date(Date.now() - 14 * 86_400_000);
    const draft = (await ctx.callAsSystem(getService("invoicing.createDraft"), {
      contactId: person.id,
      currency: "CAD",
      sourceType: "manual",
      sourceId: `demo-invoice:${input.runId}:${input.generation}`,
      idempotencyKey: `demo-invoice:${input.runId}:${input.generation}`,
      dueAt,
      lines: [
        {
          description,
          quantityMicros: 1_000_000,
          unitAmountMinor: 18_000,
        },
      ],
      tax: { mode: "not_applicable", reason: "Demo fixture is not a taxable sale." },
    })) as { invoice: { id: string } };
    await ctx.callAsSystem(getService("invoicing.issue"), { id: draft.invoice.id, dueAt });
    await ctx.callAsSystem(getService("invoicing.markOverdue"), { id: draft.invoice.id });
    return demoLoadResultSchema.parse({
      records: [
        { fixtureKey: "overdue-invoice", subjectType: "invoice", subjectId: draft.invoice.id, label: description },
      ],
    });
  },
});

export const purgeDemoInvoice = defineService({
  name: "invoicing.purgeDemoFixture",
  summary: "Delete only invoices proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "purge");
    const ids = input.records.map((record) => record.subjectId);
    if (ids.length) await ctx.tx.delete(invoices).where(eq(invoices.id, ids[0]!));
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoInvoice = defineService({
  name: "invoicing.verifyDemoFixture",
  summary: "Verify the marked overdue invoice is still open.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "verify");
    const id = input.records[0]?.subjectId;
    const [invoice] = id
      ? await ctx.tx
          .select({ id: invoices.id, status: invoices.status })
          .from(invoices)
          .where(eq(invoices.id, id))
          .limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "invoicing.demo-invoice.visible",
          achieved: invoice?.status === "overdue",
          detail: invoice?.status,
        },
      ],
    });
  },
});

export default [loadDemoInvoice, purgeDemoInvoice, verifyDemoInvoice];
