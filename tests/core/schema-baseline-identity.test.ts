// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C10.19: the reviewed baseline must match the pre-collapse chain.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIXTURE,
  diffCatalogs,
  normalizeCatalogLine,
  proveBaselineIdentity,
  resolveChainRef,
} from "../../scripts/schema-baseline-identity.mjs";
import { hasDatabase } from "../helpers/spine";

describe("catalog name normalization", () => {
  it("treats drizzle FK names as the same constraint as Postgres *_fkey", () => {
    const chain =
      "con\tbookings\tbookings_contact_id_fkey\tFOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT";
    const baseline =
      "con\tbookings\tbookings_contact_id_contacts_id_fk\tFOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT";
    expect(normalizeCatalogLine(chain)).toBe(normalizeCatalogLine(baseline));
    expect(diffCatalogs(chain + "\n", baseline + "\n").ok).toBe(true);
  });

  it("still fails when ON DELETE disagrees", () => {
    const chain =
      "con\tupdate_runs\tupdate_runs_snapshot_fk\tFOREIGN KEY (snapshot_id) REFERENCES update_snapshots(id) ON DELETE SET NULL";
    const baseline =
      "con\tupdate_runs\tx\tFOREIGN KEY (snapshot_id) REFERENCES update_snapshots(id)";
    expect(diffCatalogs(chain + "\n", baseline + "\n").ok).toBe(false);
  });

  it("ignores index names and keeps predicates", () => {
    const chain =
      "idx\tcalendars\tcalendars_ics_token_idx\tCREATE UNIQUE INDEX calendars_ics_token_idx ON public.calendars USING btree (ics_token) WHERE (ics_token IS NOT NULL)";
    const baseline =
      "idx\tcalendars\tcalendars_ics_token_idx\tCREATE UNIQUE INDEX other_name ON public.calendars USING btree (ics_token) WHERE (ics_token IS NOT NULL)";
    expect(diffCatalogs(chain + "\n", baseline + "\n").ok).toBe(true);
  });
});

describe("the checked-in chain catalog", () => {
  it("is present so a shallow clone can still fail CI", () => {
    expect(existsSync(FIXTURE)).toBe(true);
    const text = readFileSync(FIXTURE, "utf8");
    expect(text).toMatch(/^col\t/m);
    expect(text).toMatch(/\bpg_trgm\b/);
    expect(text).toMatch(/bookings_no_overlap/);
    expect(text).toMatch(/freeholder_sync_asset_byte_size/);
  });

  it("documents how to obtain the chain when git history is available", () => {
    const ref = resolveChainRef();
    if (ref) {
      expect(ref).toMatch(/^[0-9a-f]{7,}(\^)?$/i);
    } else {
      expect(existsSync(FIXTURE)).toBe(true);
    }
  });
});

describe.runIf(hasDatabase)("fresh baseline apply vs the chain", () => {
  it("produces a structurally identical catalog", async () => {
    const result = await proveBaselineIdentity();
    expect(result.failures, result.failures.join("\n")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.vsFixture?.ok).toBe(true);
    if (result.vsChain) expect(result.vsChain.ok).toBe(true);
  }, 120_000);
});
