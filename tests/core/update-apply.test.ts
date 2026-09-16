// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyUpdate as runApply } from "@/core/update/apply";
import { applyUpdate, listUpdateRuns } from "@/core/update/service";
import { PLATFORM_VERSION } from "@/core/platform";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("update apply (C10.06)", { timeout: 60_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("snapshots, smokes, drafts a release note and completes", async () => {
    const result = await runApply({ actor: OWNER, trigger: "admin" });
    expect(result.status).toBe("completed");
    expect(result.snapshotId).toBeTruthy();
    expect(result.noteId).toBeTruthy();
    const history = await listUpdateRuns.call({ limit: 5 }, OWNER);
    expect(history.runs[0]?.status).toBe("completed");
    expect(history.notes[0]?.kind).toBe("platform_upgrade");
    expect(history.notes[0]?.title).toMatch(PLATFORM_VERSION);
  });

  it("rolls back automatically when smoke fails", async () => {
    const result = await runApply({ actor: OWNER, failAt: "smoke" });
    expect(result.status).toBe("rolled_back");
    expect(result.noteId).toBeNull();
  });

  it("refuses anonymous callers", async () => {
    const denied = await failure(applyUpdate.call({}, ANONYMOUS));
    expect(denied.code).toBe("permission");
  });
});
