// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Database proof for transactional demo load/reload/reset/purge and isolation.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import {
  loadDemoScenario,
  purgeDemoScenario,
  reloadDemoScenario,
  resetDemoScenario,
} from "@/core/demo/service";
import { demoRecords, demoScenarioRuns } from "@/core/demo/schema";
import { pages } from "@/modules/cms/schema";
import { createPage } from "@/modules/cms/service";
import { forms } from "@/modules/forms/schema";
import { createForm, loadDemoForms } from "@/modules/forms/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

const suite = describe.runIf(hasDatabase);

suite("deterministic demo scenarios", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("loads idempotently, reloads by generation, resets by run and purges exactly", async () => {
    const first = await loadDemoScenario.call(
      { key: "seed.current-modules", locale: "en" },
      OWNER,
    );
    expect(first.action).toBe("loaded");
    const generationOne = await db()
      .select()
      .from(demoRecords)
      .where(
        and(
          eq(demoRecords.runId, first.run.id),
          eq(demoRecords.generation, 1),
        ),
      );
    expect(generationOne.map((row) => row.fixtureKey).sort()).toEqual([
      "enquiry-form",
      "project-page",
    ]);

    const again = await loadDemoScenario.call(
      { key: "seed.current-modules", locale: "en" },
      OWNER,
    );
    expect(again.action).toBe("unchanged");
    expect(again.run.id).toBe(first.run.id);
    expect(await db().select().from(demoRecords)).toHaveLength(2);

    const reloaded = await reloadDemoScenario.call({}, OWNER);
    expect(reloaded.run.id).toBe(first.run.id);
    expect(reloaded.run.generation).toBe(2);
    const provenance = await db().select().from(demoRecords);
    expect(provenance).toHaveLength(4);
    expect(new Set(provenance.map((row) => row.generation))).toEqual(
      new Set([1, 2]),
    );
    expect(await db().select().from(pages).where(eq(pages.slug, "freeholder-demo-project"))).toHaveLength(1);
    expect(await db().select().from(forms).where(eq(forms.slug, "freeholder-demo-enquiry"))).toHaveLength(1);

    const reset = await resetDemoScenario.call(
      { key: "seed.current-modules", locale: "fr" },
      OWNER,
    );
    expect(reset.run.id).not.toBe(first.run.id);
    expect(reset.run.generation).toBe(1);
    const [oldRun] = await db()
      .select()
      .from(demoScenarioRuns)
      .where(eq(demoScenarioRuns.id, first.run.id));
    expect(oldRun?.status).toBe("purged");
    const [frenchPage] = await db()
      .select()
      .from(pages)
      .where(eq(pages.slug, "freeholder-demo-project"));
    const [frenchForm] = await db()
      .select()
      .from(forms)
      .where(eq(forms.slug, "freeholder-demo-enquiry"));
    expect(frenchPage?.title).toContain("premier projet");
    expect(frenchForm?.name).toContain("Demande de projet");

    const productionPage = await createPage.call(
      { slug: "real-business", title: "Real business", blocks: [] },
      OWNER,
    );
    const productionForm = await createForm.call(
      { slug: "real-enquiry", name: "Real enquiry", fields: [] },
      OWNER,
    );
    const purged = await purgeDemoScenario.call({}, OWNER);
    expect(purged.action).toBe("purged");
    expect(await db().select().from(pages).where(eq(pages.id, productionPage.id))).toHaveLength(1);
    expect(await db().select().from(forms).where(eq(forms.id, productionForm.id))).toHaveLength(1);
    expect(await db().select().from(pages).where(eq(pages.slug, "freeholder-demo-project"))).toHaveLength(0);
    expect(await db().select().from(forms).where(eq(forms.slug, "freeholder-demo-enquiry"))).toHaveLength(0);
    expect(
      await db()
        .select()
        .from(demoScenarioRuns)
        .where(eq(demoScenarioRuns.status, "active")),
    ).toHaveLength(0);
  });

  it("rolls back the run and earlier module fixtures when a later fixture conflicts", async () => {
    const production = await createForm.call(
      {
        slug: "freeholder-demo-enquiry",
        name: "A real form using the reserved-looking slug",
        fields: [],
      },
      OWNER,
    );
    const error = await failure(
      loadDemoScenario.call({ key: "seed.current-modules" }, OWNER),
    );
    expect(error.code).toBe("conflict");
    expect(await db().select().from(demoScenarioRuns)).toHaveLength(0);
    expect(await db().select().from(demoRecords)).toHaveLength(0);
    expect(await db().select().from(pages).where(eq(pages.slug, "freeholder-demo-project"))).toHaveLength(0);
    expect(await db().select().from(forms).where(eq(forms.id, production.id))).toHaveLength(1);
  });

  it("refuses direct fixture-handler calls without orchestrated run provenance", async () => {
    const error = await failure(
      loadDemoForms.call(
        {
          scenarioKey: "seed.current-modules",
          scenarioVersion: 1,
          runId: crypto.randomUUID(),
          generation: 1,
          locale: "en",
          records: [],
        },
        OWNER,
      ),
    );
    expect(error.code).toBe("conflict");
    expect(await db().select().from(forms)).toHaveLength(0);
  });
});
