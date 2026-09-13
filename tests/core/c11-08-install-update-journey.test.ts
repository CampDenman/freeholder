// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.08 pieces that exist: role-guided demo load, WordPress parse/preview/
// commit that writes CMS pages, ownership-export contract, signed local
// update and failed-update rollback. Restore on another Tier-1 target
// remains the ownership-drill pair matrix — this file does not fake it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyUpdate as runApply } from "@/core/update/apply";
import { listUpdateRuns } from "@/core/update/service";
import { EXPORT_FORMAT } from "@/core/portability/ownership-export.mjs";
import { MIGRATION_ARTIFACTS, migrationContract } from "@/core/portability/archive";
import { loadDemoScenario } from "@/core/demo/service";
import { pages } from "@/modules/cms/schema";
import { forms } from "@/modules/forms/schema";
import { db } from "@/core/db";
import { eq } from "drizzle-orm";
import {
  commitImport,
  previewFromSource,
  publishImport,
  reconcileImport,
  startImport,
} from "@/core/import/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("C11.08 demo import update rollback", { timeout: 90_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("loads a demo, stages a WordPress import ledger, and rolls back a failed update", async () => {
    const demo = await loadDemoScenario.call({ key: "seed.current-modules", locale: "en" }, OWNER);
    expect(demo.action).toBe("loaded");
    expect(
      await db().select().from(pages).where(eq(pages.slug, "freeholder-demo-project")),
    ).toHaveLength(1);
    expect(
      await db().select().from(forms).where(eq(forms.slug, "freeholder-demo-enquiry")),
    ).toHaveLength(1);

    const run = await startImport.call(
      { origin: "https://example.com", kind: "wordpress-rest" },
      OWNER,
    );
    const previewed = await previewFromSource.call(
      {
        id: run.id,
        payload: JSON.stringify([
          {
            link: "https://example.com/about",
            slug: "about",
            type: "page",
            title: { rendered: "About" },
            content: { rendered: "<p>Hi</p>" },
          },
        ]),
      },
      OWNER,
    );
    expect(previewed.status).toBe("previewed");
    await commitImport.call({ id: run.id }, OWNER);
    const [draft] = await db().select().from(pages).where(eq(pages.slug, "about"));
    expect(draft).toMatchObject({ slug: "about", title: "About", status: "draft" });
    await reconcileImport.call({ id: run.id, counts: { pages: 1, media: 0, redirects: 0 } }, OWNER);
    const published = await publishImport.call({ id: run.id }, OWNER);
    expect(published.status).toBe("published");
    const [live] = await db().select().from(pages).where(eq(pages.slug, "about"));
    expect(live?.status).toBe("published");

    expect(MIGRATION_ARTIFACTS.logical).toBe(EXPORT_FORMAT);
    const contract = migrationContract("replit", "railway");
    expect(contract.artifacts).toBe(MIGRATION_ARTIFACTS);

    const ok = await runApply({ actor: OWNER, trigger: "admin" });
    expect(ok.status).toBe("completed");
    const failed = await runApply({ actor: OWNER, failAt: "smoke" });
    expect(failed.status).toBe("rolled_back");
    const history = await listUpdateRuns.call({ limit: 5 }, OWNER);
    expect(history.runs.some((row) => row.status === "completed")).toBe(true);
    expect(history.runs.some((row) => row.status === "rolled_back")).toBe(true);
  });

  it("commits a generic HTML import as a CMS draft", async () => {
    const run = await startImport.call(
      { origin: "https://example.com", kind: "html" },
      OWNER,
    );
    const previewed = await previewFromSource.call(
      {
        id: run.id,
        payload:
          "<html lang='en'><head><link rel='canonical' href='https://example.com/team'><title>Team</title></head><article><p>We work here.</p></article></html>",
      },
      OWNER,
    );
    expect(previewed.status).toBe("previewed");
    await commitImport.call({ id: run.id }, OWNER);
    const [page] = await db().select().from(pages).where(eq(pages.slug, "team"));
    expect(page).toMatchObject({ slug: "team", title: "Team", status: "draft" });
  });
});
