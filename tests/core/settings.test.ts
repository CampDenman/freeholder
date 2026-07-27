// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Business identity (MASTER.md §4.8, §13). One deploy is one business, and the
// database is what enforces that — not a convention anyone has to remember.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { businessProfile } from "@/core/settings/schema";
import { auditLog } from "@/core/events/schema";
import {
  completeSetup,
  getBusiness,
  listModules,
  patchBusiness,
  setModuleEnabled,
  setupState,
  updateBusiness,
} from "@/core/settings/service";
import { registerOwner } from "@/core/auth/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

const A_BUSINESS = {
  name: "Aurora Coast Photography",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
  defaultLocale: "en",
  enabledLocales: ["en", "fr-CA"],
  schemaType: "Photographer",
};

describe.runIf(hasDatabase)("business settings", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  describe("the profile is a singleton", () => {
    it("refuses a second row at the database level", async () => {
      await updateBusiness.call(A_BUSINESS, OWNER);
      // Single-tenant (§2 principle 1) enforced by a check constraint, so no
      // amount of clever calling produces a second business.
      await expect(
        db().execute(sql`
          insert into business_profile (id, name, country, base_currency, timezone)
          values (2, 'Second Business', 'US', 'USD', 'UTC')
        `),
      ).rejects.toThrow();
      const rows = await db().select().from(businessProfile);
      expect(rows).toHaveLength(1);
    });

    it("updates in place rather than accumulating rows", async () => {
      await updateBusiness.call(A_BUSINESS, OWNER);
      await updateBusiness.call(
        { ...A_BUSINESS, name: "Aurora Coast Studio" },
        OWNER,
      );
      const rows = await db().select().from(businessProfile);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe("Aurora Coast Studio");
    });
  });

  describe("validation the database backs up", () => {
    it("normalises country and currency to upper case", async () => {
      const profile = await updateBusiness.call(
        { ...A_BUSINESS, country: "ca", baseCurrency: "cad" },
        OWNER,
      );
      expect(profile.country).toBe("CA");
      expect(profile.baseCurrency).toBe("CAD");
    });

    it("rejects a country that is not two letters", async () => {
      const error = await failure(
        updateBusiness.call({ ...A_BUSINESS, country: "CAN" }, OWNER),
      );
      expect(error.code).toBe("validation");
    });

    it("rejects a malformed locale", async () => {
      const error = await failure(
        updateBusiness.call({ ...A_BUSINESS, defaultLocale: "english" }, OWNER),
      );
      expect(error.code).toBe("validation");
      expect(error.message).toContain("BCP-47");
    });

    it("requires at least one enabled locale", async () => {
      const error = await failure(
        updateBusiness.call({ ...A_BUSINESS, enabledLocales: [] }, OWNER),
      );
      expect(error.code).toBe("validation");
    });
  });

  describe("permissions", () => {
    it("lets anyone read the profile — public pages render from it", async () => {
      await updateBusiness.call(A_BUSINESS, OWNER);
      const profile = await getBusiness.call({}, ANONYMOUS);
      expect(profile?.name).toBe("Aurora Coast Photography");
    });

    it("answers null before there is a business", async () => {
      expect(await getBusiness.call({}, ANONYMOUS)).toBeNull();
    });

    it("refuses writes from staff", async () => {
      const error = await failure(updateBusiness.call(A_BUSINESS, STAFF));
      expect(error.code).toBe("permission");
    });
  });

  describe("patchBusiness", () => {
    it("changes one field without restating the rest", async () => {
      await updateBusiness.call(A_BUSINESS, OWNER);
      const patched = await patchBusiness.call({ tagline: "Coastal light" }, OWNER);
      expect(patched.tagline).toBe("Coastal light");
      expect(patched.country).toBe("CA");
    });

    it("refuses an empty patch", async () => {
      await updateBusiness.call(A_BUSINESS, OWNER);
      const error = await failure(patchBusiness.call({}, OWNER));
      expect(error.code).toBe("validation");
    });

    it("does not resupply defaults for fields it was not given", async () => {
      // `.partial()` keeps `.default()`, so patching from the creation schema
      // would silently reset locale, units and week start every time somebody
      // edited a tagline. The patch schema is built without defaults for this.
      await updateBusiness.call(
        {
          ...A_BUSINESS,
          units: "imperial",
          firstDayOfWeek: 0,
          schemaType: "Photographer",
        },
        OWNER,
      );
      const patched = await patchBusiness.call({ tagline: "Coastal light" }, OWNER);
      expect(patched.units).toBe("imperial");
      expect(patched.firstDayOfWeek).toBe(0);
      expect(patched.schemaType).toBe("Photographer");
      expect(patched.enabledLocales).toEqual(["en", "fr-CA"]);
    });

    it("says so plainly when there is no profile yet", async () => {
      const error = await failure(patchBusiness.call({ tagline: "x" }, OWNER));
      expect(error.code).toBe("not_found");
      expect(error.message).toMatch(/complete setup first/i);
    });
  });

  describe("setup state and locking", () => {
    it("reports what first boot still needs", async () => {
      expect(await setupState.call({}, ANONYMOUS)).toEqual({
        hasOwner: false,
        hasBusiness: false,
        completed: false,
      });

      await registerOwner.call(
        { email: "owner@example.test", password: "a-long-enough-password" },
        ANONYMOUS,
      );
      expect(await setupState.call({}, ANONYMOUS)).toMatchObject({
        hasOwner: true,
        hasBusiness: false,
      });

      await updateBusiness.call(A_BUSINESS, OWNER);
      expect(await setupState.call({}, ANONYMOUS)).toMatchObject({
        hasBusiness: true,
        completed: false,
      });

      await completeSetup.call({}, OWNER);
      expect(await setupState.call({}, ANONYMOUS)).toMatchObject({
        completed: true,
      });
    });

    it("locks itself, so the wizard cannot be replayed", async () => {
      // §13: locked after completion. Replaying it against a live business is
      // how a public demo gets reset by a passer-by.
      await updateBusiness.call(A_BUSINESS, OWNER);
      await completeSetup.call({}, OWNER);
      const error = await failure(completeSetup.call({}, OWNER));
      expect(error.code).toBe("conflict");
    });

    it("will not complete before there is anything to complete", async () => {
      const error = await failure(completeSetup.call({}, OWNER));
      expect(error.code).toBe("not_found");
    });

    it("leaks nothing about the owner", async () => {
      await registerOwner.call(
        { email: "secret@example.test", password: "a-long-enough-password" },
        ANONYMOUS,
      );
      const state = await setupState.call({}, ANONYMOUS);
      expect(JSON.stringify(state)).not.toContain("secret@example.test");
    });
  });

  describe("the audit trail records non-uuid subjects", () => {
    it("audits a settings change, whose subject is not a uuid", async () => {
      // audit_log.subject_id was typed uuid, which asserted that every subject
      // in the system is one. A module name is not, and a singleton profile id
      // is not, so auditing either was impossible until the column became text.
      await updateBusiness.call(A_BUSINESS, OWNER);
      await setModuleEnabled.call({ module: "galleries", enabled: false }, OWNER);

      const rows = await db().select().from(auditLog).orderBy(auditLog.at);
      expect(rows.map((r) => [r.action, r.subjectType, r.subjectId])).toEqual([
        ["settings.updateBusiness", "business_profile", "1"],
        ["settings.setModuleEnabled", "module_settings", "galleries"],
      ]);
    });
  });

  describe("module toggles", () => {
    it("records a toggle and reads it back", async () => {
      await setModuleEnabled.call({ module: "galleries", enabled: false }, OWNER);
      const modules = await listModules.call({}, STAFF);
      expect(modules).toEqual([
        expect.objectContaining({ module: "galleries", enabled: false }),
      ]);
    });

    it("flips an existing toggle instead of duplicating it", async () => {
      await setModuleEnabled.call({ module: "booking", enabled: false }, OWNER);
      await setModuleEnabled.call({ module: "booking", enabled: true }, OWNER);
      const modules = await listModules.call({}, STAFF);
      expect(modules).toHaveLength(1);
      expect(modules[0]!.enabled).toBe(true);
    });

    it("refuses to switch core off", async () => {
      // Core carries auth. Turning it off would lock the owner out of their
      // own instance with no way back in.
      const error = await failure(
        setModuleEnabled.call({ module: "core", enabled: false }, OWNER),
      );
      expect(error.code).toBe("validation");
      expect(await listModules.call({}, STAFF)).toHaveLength(0);
    });

    it("is owner-only to write and staff-readable", async () => {
      const error = await failure(
        setModuleEnabled.call({ module: "cms", enabled: false }, STAFF),
      );
      expect(error.code).toBe("permission");
      await expect(listModules.call({}, STAFF)).resolves.toEqual([]);
    });
  });
});
