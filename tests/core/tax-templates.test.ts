// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.04: every target jurisdiction ships a source-attributed starter, and an
// owner can still define a zone the catalog does not cover.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { taxRegistrations, taxZones } from "@/modules/invoicing/schema";
import {
  createTaxZone,
  installTaxTemplate,
  listTaxTemplates,
  setTaxRegistration,
} from "@/modules/invoicing/tax-service";
import { taxTemplates } from "@/modules/invoicing/tax-templates";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const GROUP_KEYS = {
  canada: "ca-on",
  european_union: "eu-de",
  united_kingdom: "gb-standard",
  united_states: "us-ca-base",
  australia: "au-standard",
  new_zealand: "nz-standard",
} as const;

describe("C5.04 tax template groups", () => {
  it("ships a starter for every named jurisdiction group", () => {
    const groups = new Set(taxTemplates.map((template) => template.group));
    expect(groups).toEqual(
      new Set([
        "canada",
        "european_union",
        "united_kingdom",
        "united_states",
        "australia",
        "new_zealand",
      ]),
    );
    expect(taxTemplates.filter((template) => template.group === "canada")).toHaveLength(13);
    expect(taxTemplates.filter((template) => template.group === "european_union")).toHaveLength(27);
    expect(taxTemplates.filter((template) => template.group === "united_kingdom")).toHaveLength(1);
    expect(taxTemplates.filter((template) => template.group === "united_states")).toHaveLength(51);
    expect(taxTemplates.filter((template) => template.group === "australia")).toHaveLength(1);
    expect(taxTemplates.filter((template) => template.group === "new_zealand")).toHaveLength(1);
    expect(taxTemplates.every((template) => template.source.url.startsWith("https://"))).toBe(true);
    expect(taxTemplates.every((template) => template.activationLimitation)).toBe(true);
    expect(taxTemplates.find((template) => template.key === "us-ca-base")?.activationLimitation).toContain(
      "not an address-level checkout rate",
    );
  });
});

describe.runIf(hasDatabase)("C5.04 install and custom zones", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("installs one starter from each group into monitoring mode", async () => {
    for (const [group, key] of Object.entries(GROUP_KEYS)) {
      const listed = await listTaxTemplates.call({ group: group as keyof typeof GROUP_KEYS }, OWNER);
      expect(listed.templates.some((template) => template.key === key)).toBe(true);
      const installed = await installTaxTemplate.call({ key }, OWNER);
      expect(installed).toMatchObject({
        created: true,
        template: { key, group },
        registration: { status: "monitoring" },
      });
      expect(installed.rates.length).toBeGreaterThan(0);
    }
    expect(await db().select().from(taxZones)).toHaveLength(6);
    expect(await db().select().from(taxRegistrations)).toHaveLength(6);
  });

  it("lets an owner define a zone the starters do not cover, without a template interlock", async () => {
    const zone = await createTaxZone.call(
      {
        name: "Japan consumption tax",
        country: "JP",
        regions: [],
        postalPatterns: [],
        basis: "destination",
        pricesIncludeTax: true,
        roundingScope: "invoice",
        roundingMode: "half_up",
      },
      OWNER,
    );
    expect(zone.templateKey).toBeNull();
    const registration = await setTaxRegistration.call(
      {
        zoneId: zone.id,
        number: "T1234567890123",
        status: "active",
      },
      OWNER,
    );
    expect(registration).toMatchObject({ status: "active", number: "T1234567890123" });
  });

  it("still requires an explicit limitation acknowledgement on a starter", async () => {
    const installed = await installTaxTemplate.call({ key: "gb-standard" }, OWNER);
    if (!installed.registration) throw new Error("expected a monitoring registration");
    const blocked = await failure(
      setTaxRegistration.call(
        {
          id: installed.registration.id,
          zoneId: installed.zone.id,
          number: "GB123",
          status: "active",
        },
        OWNER,
      ),
    );
    expect(blocked.code).toBe("validation");
    expect(blocked.message).toContain("Review required");
    await expect(
      setTaxRegistration.call(
        {
          id: installed.registration.id,
          zoneId: installed.zone.id,
          number: "GB123",
          status: "active",
          acknowledgeTemplateLimitations: true,
        },
        OWNER,
      ),
    ).resolves.toMatchObject({ status: "active", number: "GB123" });
  });
});
