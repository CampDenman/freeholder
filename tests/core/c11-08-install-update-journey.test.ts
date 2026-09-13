// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.08 pieces that exist: role-guided demo load, WordPress parse/preview/
// commit ledger, ownership-export contract, signed local update and failed-
// update rollback. Import commit does not materialize CMS pages, and restore
// on another Tier-1 target remains the ownership-drill pair matrix — this
// file does not fake either.
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
    await reconcileImport.call({ id: run.id, counts: { pages: 1, media: 0, redirects: 0 } }, OWNER);
    const published = await publishImport.call({ id: run.id }, OWNER);
    expect(published.status).toBe("published");
    // Honest gap: the ledger is published; CMS pages are not written from it.
    expect(await db().select().from(pages).where(eq(pages.slug, "about"))).toHaveLength(0);

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
});
