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
import { defineService, ServiceError } from "@/core/service";
import { quotes } from "./schema";

const CONTRIBUTION = { key: "quotes.demo-quote", version: 1 } as const;
const TITLES = {
  en: "[Demo] Family sitting package",
  fr: "[Demo] Forfait séance famille",
  es: "[Demo] Paquete de sesión familiar",
} as const;

export const loadDemoQuote = defineService({
  name: "quotes.loadDemoFixture",
  summary: "Draft a marked quote for the demo customer.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoLoadResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "load");
    const [person] = await ctx.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, "jordan.hale@demo.freeholder.test"))
      .limit(1);
    if (!person) throw new ServiceError("conflict", "Demo quote needs the customer contact.");
    const title = TITLES[input.locale as keyof typeof TITLES] ?? TITLES.en;
    const [created] = await ctx.tx
      .insert(quotes)
      .values({
        contactId: person.id,
        reference: `DEMO-${input.generation}-${input.runId.slice(0, 8)}`,
        title,
        currency: "CAD",
        status: "sent",
      })
      .returning({ id: quotes.id });
    return demoLoadResultSchema.parse({
      records: [{ fixtureKey: "package", subjectType: "quote", subjectId: created!.id, label: title }],
    });
  },
});

export const purgeDemoQuote = defineService({
  name: "quotes.purgeDemoFixture",
  summary: "Delete only quotes proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "purge");
    const ids = input.records.map((record) => record.subjectId);
    if (ids.length) await ctx.tx.delete(quotes).where(eq(quotes.id, ids[0]!));
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoQuote = defineService({
  name: "quotes.verifyDemoFixture",
  summary: "Verify the marked quote is still listed.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "verify");
    const id = input.records[0]?.subjectId;
    const [quote] = id
      ? await ctx.tx.select({ title: quotes.title, status: quotes.status }).from(quotes).where(eq(quotes.id, id)).limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "quotes.demo-quote.visible",
          achieved: quote?.status === "sent" && Boolean(quote.title.startsWith("[Demo]")),
          detail: quote?.title,
        },
      ],
    });
  },
});

export default [loadDemoQuote, purgeDemoQuote, verifyDemoQuote];
