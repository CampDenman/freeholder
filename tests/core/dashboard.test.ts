// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The read side the admin overview is built on: how many contacts there are,
// and what has changed lately (§4.8 — "the owner can read a plain-English log
// of everything their AI did").
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { contactStats, createContact, resolveContact } from "@/core/contacts/service";
import { recentActivity } from "@/core/events/service";
import { auditLog } from "@/core/events/schema";
import { createPage } from "@/modules/cms/service";
import { applyDueSchedules, schedulePage } from "@/modules/cms/lifecycle";
import { db } from "@/core/db";
import { updateBusiness } from "@/core/settings/service";
import {
  ANONYMOUS,
  closeDb,
  CUSTOMER,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("the admin overview data", () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  describe("contacts.stats", () => {
    it("reports zeros rather than nothing on a fresh install", async () => {
      // An empty dashboard still has to render, and "0" is a real answer.
      expect(await contactStats.call({}, STAFF)).toEqual({
        total: 0,
        byStage: { lead: 0, prospect: 0, customer: 0, repeat: 0 },
      });
    });

    it("counts by lifecycle stage", async () => {
      await createContact.call({ name: "A", lifecycleStage: "lead" }, STAFF);
      await createContact.call({ name: "B", lifecycleStage: "lead" }, STAFF);
      await createContact.call(
        { name: "C", lifecycleStage: "customer" },
        STAFF,
      );

      expect(await contactStats.call({}, STAFF)).toEqual({
        total: 3,
        byStage: { lead: 2, prospect: 0, customer: 1, repeat: 0 },
      });
    });

    it("is staff-only", async () => {
      const error = await failure(contactStats.call({}, CUSTOMER));
      expect(error.code).toBe("permission");
    });
  });

  describe("events.recentActivity", () => {
    it("returns newest first", async () => {
      await updateBusiness.call(
        {
          name: "Aurora Coast Photography",
          country: "CA",
          baseCurrency: "CAD",
          timezone: "America/Vancouver",
        },
        OWNER,
      );
      await createContact.call({ name: "Ada" }, STAFF);

      const activity = await recentActivity.call({ limit: 10 }, STAFF);
      expect(activity.map((row) => row.action)).toEqual([
        "contacts.create",
        "settings.updateBusiness",
      ]);
      expect(activity[0]!.actor).toBe(`user:${STAFF.userId}`);
    });

    it("honours the limit", async () => {
      for (let i = 0; i < 5; i += 1) {
        await createContact.call({ name: `Contact ${i}` }, STAFF);
      }
      expect(await recentActivity.call({ limit: 3 }, STAFF)).toHaveLength(3);
    });

    it("refuses an absurd limit rather than trying to serve it", async () => {
      const error = await failure(recentActivity.call({ limit: 5000 }, STAFF));
      expect(error.code).toBe("validation");
    });

    it("records agent actions under the key that did them", async () => {
      // This is the §4.8 promise in practice: an owner can see what the AI did.
      // resolve, not create: deliberate entry is human-only, and resolving
      // is the door an agent's key actually opens onto the spine.
      await resolveContact.call(
        { name: "Made by an agent", email: "agent-made@example.test" },
        { kind: "agent", keyName: "claude", scopes: ["contacts.*"] },
      );
      const [entry] = await recentActivity.call({ limit: 1 }, STAFF);
      expect(entry!.actor).toBe("agent:claude");
    });

    it("leaves platform housekeeping out of the owner's feed", async () => {
      // The demo audit: "What changed" was a wall of "Delete presence rows
      // whose heartbeat has gone quiet" by "The platform". The people view
      // drops system work and demo entry; the full trail is still one
      // `include: "all"` away for diagnostics.
      await createContact.call({ name: "Ada" }, STAFF);
      await db().insert(auditLog).values([
        { actor: "system", action: "cms.expireStalePresence" },
        { actor: "system", action: "media.expireCaptureSessions" },
        { actor: "user:00000000-0000-4000-8000-000000000000", action: "playground.enter" },
        // A payment webhook applies its event as `system`; the owner must
        // still see it, so the filter is by action, never by actor.
        { actor: "system", action: "invoicing.applyProviderEvent" },
      ]);

      const people = await recentActivity.call({ limit: 10, include: "people" }, STAFF);
      expect(people.map((row) => row.action).sort()).toEqual(
        ["contacts.create", "invoicing.applyProviderEvent"],
      );

      const all = await recentActivity.call({ limit: 10 }, STAFF);
      expect(all.map((row) => row.action).sort()).toEqual([
        "cms.expireStalePresence",
        "contacts.create",
        "invoicing.applyProviderEvent",
        "media.expireCaptureSessions",
        "playground.enter",
      ]);
    });

    it("shows a scheduled publish, but not the ticks that found nothing due", async () => {
      // Owners should see the sweep that published their page; the same
      // sweep running every minute with nothing due writes no row at all.
      const system = { kind: "system" } as const;
      await applyDueSchedules.call({}, system);
      const created = await createPage.call(
        {
          slug: "soon",
          title: "Soon",
          blocks: [{ id: "h", type: "heading", props: { text: "Soon", level: 1 } }],
        },
        OWNER,
      );
      await schedulePage.call({ id: created.id, publishAt: new Date(Date.now() - 1_000) }, OWNER);
      const applied = await applyDueSchedules.call({}, system);
      expect(applied.published).toContain(created.id);
      await applyDueSchedules.call({}, system);

      const people = await recentActivity.call({ limit: 20, include: "people" }, STAFF);
      const actions = people.map((row) => row.action);
      expect(actions.filter((action) => action === "cms.applyDueSchedules")).toHaveLength(1);
      expect(actions).toContain("cms.publishPage");
      const all = await recentActivity.call({ limit: 20 }, STAFF);
      expect(all.filter((row) => row.action === "cms.applyDueSchedules")).toHaveLength(1);
    });

    it("is not readable by a customer or a stranger", async () => {
      expect((await failure(recentActivity.call({}, CUSTOMER))).code).toBe(
        "permission",
      );
      expect((await failure(recentActivity.call({}, ANONYMOUS))).code).toBe(
        "permission",
      );
    });
  });
});

describe("select option lists", () => {
  it("covers every timezone and currency the platform can store", async () => {
    const { ALL_TIMEZONES, ALL_CURRENCIES } = await import(
      "@/core/settings/defaults"
    );
    // The bug this guards: the timezone select was built from the country
    // sample table, which lists America/Toronto for Canada but not Vancouver.
    // A business stored as America/Vancouver rendered with the *first* option
    // selected — Africa/Johannesburg — so saving the form without touching it
    // moved the business to another continent.
    expect(ALL_TIMEZONES).toContain("America/Vancouver");
    expect(ALL_TIMEZONES).toContain("America/Toronto");
    expect(ALL_TIMEZONES).toContain("Europe/Paris");
    expect(ALL_TIMEZONES.length).toBeGreaterThan(300);

    expect(ALL_CURRENCIES).toContain("CAD");
    expect(ALL_CURRENCIES).toContain("JPY");
    expect(ALL_CURRENCIES.length).toBeGreaterThan(100);
  });

  it("every country default is selectable in the lists it feeds", async () => {
    const { ALL_TIMEZONES, ALL_CURRENCIES, COUNTRY_DEFAULTS } = await import(
      "@/core/settings/defaults"
    );
    for (const entry of COUNTRY_DEFAULTS) {
      expect(ALL_TIMEZONES, entry.code).toContain(entry.timezone);
      expect(ALL_CURRENCIES, entry.code).toContain(entry.currency);
    }
  });

  it("withCurrent keeps a stored value selectable even off-list", async () => {
    const { withCurrent } = await import("@/core/settings/defaults");
    expect(withCurrent(["CA", "US"], "CA")).toEqual(["CA", "US"]);
    // A country stored before the list grew must still be choosable.
    expect(withCurrent(["CA", "US"], "IS")).toEqual(["IS", "CA", "US"]);
    expect(withCurrent(["CA"], undefined)).toEqual(["CA"]);
  });
});
