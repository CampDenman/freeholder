// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyUpdate as runApply } from "@/core/update/apply";
import { applyUpdate, listUpdateRuns } from "@/core/update/service";
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

  it("refuses unsupported execution without inventing snapshots or success history", async () => {
    await expect(runApply({ actor: OWNER, trigger: "admin" })).rejects.toMatchObject({ code: "conflict" });
    const history = await listUpdateRuns.call({ limit: 5 }, OWNER);
    expect(history.runs).toEqual([]);
    expect(history.notes).toEqual([]);
  });

  it("rejects the owner-facing apply service with a recoverable explanation", async () => {
    await expect(applyUpdate.call({}, OWNER)).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses anonymous callers", async () => {
    const denied = await failure(applyUpdate.call({}, ANONYMOUS));
    expect(denied.code).toBe("permission");
  });
});
