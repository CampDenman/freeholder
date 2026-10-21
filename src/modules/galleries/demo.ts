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
import { galleries } from "./schema";

const CONTRIBUTION = { key: "galleries.demo-gallery", version: 1 } as const;
const TITLES = {
  en: "[Demo] Jordan's sitting proofs",
  fr: "[Demo] Épreuves de Jordan",
  es: "[Demo] Pruebas de Jordan",
} as const;

export const loadDemoGallery = defineService({
  name: "galleries.loadDemoFixture",
  summary: "Open a marked login-gated client gallery for the demo customer.",
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
    if (!person) throw new ServiceError("conflict", "Demo gallery needs the customer contact.");
    const title = TITLES[input.locale as keyof typeof TITLES] ?? TITLES.en;
    const [created] = await ctx.tx
      .insert(galleries)
      .values({
        contactId: person.id,
        title,
        slug: "freeholder-demo-gallery",
        kind: "client_delivery",
        access: "login",
        downloadPolicy: "none",
        watermark: false,
      })
      .returning({ id: galleries.id });
    return demoLoadResultSchema.parse({
      records: [{ fixtureKey: "proofs", subjectType: "gallery", subjectId: created!.id, label: title }],
    });
  },
});

export const purgeDemoGallery = defineService({
  name: "galleries.purgeDemoFixture",
  summary: "Delete only galleries proven to belong to a tracked demo run.",
  kind: "mutation",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoPurgeResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "purge");
    const ids = input.records.map((record) => record.subjectId);
    if (ids.length) await ctx.tx.delete(galleries).where(eq(galleries.id, ids[0]!));
    return demoPurgeResultSchema.parse({
      purged: input.records.map((record) => ({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
      })),
    });
  },
});

export const verifyDemoGallery = defineService({
  name: "galleries.verifyDemoFixture",
  summary: "Verify the marked client gallery is still listed.",
  kind: "query",
  permission: "scoped",
  input: demoHandlerInputSchema,
  output: demoVerifyResultSchema,
  handler: async (input, ctx) => {
    await requireDemoHandlerRun(ctx.tx, input, CONTRIBUTION, "verify");
    const id = input.records[0]?.subjectId;
    const [gallery] = id
      ? await ctx.tx
          .select({ slug: galleries.slug, title: galleries.title })
          .from(galleries)
          .where(eq(galleries.id, id))
          .limit(1)
      : [];
    return demoVerifyResultSchema.parse({
      outcomes: [
        {
          key: "galleries.demo-gallery.visible",
          achieved: gallery?.slug === "freeholder-demo-gallery" && Boolean(gallery.title.startsWith("[Demo]")),
          detail: gallery?.title,
        },
      ],
    });
  },
});

export default [loadDemoGallery, purgeDemoGallery, verifyDemoGallery];
