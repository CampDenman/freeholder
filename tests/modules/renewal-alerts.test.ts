// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.40. The two pure parts of renewal alerts: when the next charge falls,
// and what the person reads.
//
// Each test names the behaviour it is preventing rather than merely asserting
// the current one.
import { describe, expect, it } from "vitest";
import { portalSection } from "@/core/portal/sections";
import type { ServiceContext } from "@/core/service";
import { nextRenewalAfter } from "@/modules/renewal-alerts/jobs";
import { renewalAlertMessage } from "@/modules/renewal-alerts/mail";
import renewalAlertServices, {
  trackMySubscription,
} from "@/modules/renewal-alerts/service";

const at = (iso: string) => new Date(iso);

describe("nextRenewalAfter", () => {
  it("returns the first charge when it has not happened yet", () => {
    expect(nextRenewalAfter(at("2026-12-05T00:00:00Z"), "monthly", null, at("2026-11-18T00:00:00Z")))
      .toEqual(at("2026-12-05T00:00:00Z"));
  });

  it("steps monthly in calendar months, not 30-day blocks", () => {
    // Mixing the two — Math.floor(daysDiff / 30) to jump, then setMonth to
    // step — drifts a day every month that is not 30 days long, and makes the
    // answer depend on how long ago you subscribed.
    expect(nextRenewalAfter(at("2026-01-15T00:00:00Z"), "monthly", null, at("2026-11-18T00:00:00Z")))
      .toEqual(at("2026-12-15T00:00:00Z"));
  });

  it("is independent of how far in the past the first charge was", () => {
    // Same day-of-month, two very different anchors, one answer.
    const recent = nextRenewalAfter(at("2026-10-22T00:00:00Z"), "monthly", null, at("2026-11-18T00:00:00Z"));
    const ancient = nextRenewalAfter(at("2019-03-22T00:00:00Z"), "monthly", null, at("2026-11-18T00:00:00Z"));
    expect(recent).toEqual(at("2026-11-22T00:00:00Z"));
    expect(ancient).toEqual(at("2026-11-22T00:00:00Z"));
  });

  it("rolls an annual charge to the next year", () => {
    expect(nextRenewalAfter(at("2026-11-01T00:00:00Z"), "annual", null, at("2026-11-18T00:00:00Z")))
      .toEqual(at("2027-11-01T00:00:00Z"));
  });

  it("honours a custom interval in days", () => {
    expect(nextRenewalAfter(at("2026-11-01T00:00:00Z"), "custom", 10, at("2026-11-18T00:00:00Z")))
      .toEqual(at("2026-11-21T00:00:00Z"));
  });

  it("does not hang on a custom cycle with a nonsense interval", () => {
    // A zero or negative interval would be an infinite loop if the guard
    // were missing; it falls back to 30 days.
    expect(nextRenewalAfter(at("2026-01-01T00:00:00Z"), "custom", 0, at("2026-11-18T00:00:00Z")))
      .toBeInstanceOf(Date);
  });

  it("always returns a date strictly after the reference point", () => {
    const from = at("2026-11-18T09:00:00Z");
    for (const cycle of ["monthly", "annual", "custom"] as const) {
      expect(nextRenewalAfter(at("2020-02-29T00:00:00Z"), cycle, 45, from).getTime())
        .toBeGreaterThan(from.getTime());
    }
  });
});

describe("renewalAlertMessage", () => {
  const copy = {
    name: "Adobe",
    amount: "$11.01",
    renewsOn: "2026-11-22",
    daysAhead: 3,
    dashboardUrl: "/account/subscriptions",
  };

  it("always carries a plain-text part", () => {
    // OutboundEmail makes text mandatory; this asserts we actually populate
    // it rather than satisfying the type with an empty string.
    const message = renewalAlertMessage("someone@example.net", copy);
    expect(message.text.length).toBeGreaterThan(40);
    expect(message.text).toContain("Adobe");
    expect(message.text).toContain("$11.01");
  });

  it("says tomorrow rather than 'in 1 days'", () => {
    const message = renewalAlertMessage("someone@example.net", { ...copy, daysAhead: 1 });
    expect(message.subject).toContain("tomorrow");
    expect(message.subject).not.toContain("1 days");
  });

  it("escapes the subscription name in the HTML part", () => {
    // The name is free text typed by the person being emailed.
    const message = renewalAlertMessage("someone@example.net", {
      ...copy,
      name: '<img src=x onerror="alert(1)">',
    });
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img");
  });

  it("carries no advertising slot", () => {
    // A paid placement would make this message marketing, which a permission-
    // checking provider refuses when it arrives labelled service_notification.
    // There is deliberately nowhere to put one.
    const message = renewalAlertMessage("someone@example.net", copy);
    expect(JSON.stringify(message).toLowerCase()).not.toContain("sponsor");
    expect(JSON.stringify(message).toLowerCase()).not.toContain("advert");
  });
});

/* ------------------------------------------------- the member's own room */

// `import "./portal"` at the foot of the module's service file is what
// registers the room in production; importing the service here reproduces
// exactly that, rather than reaching for the portal file directly.
const section = () => {
  const found = portalSection("renewals");
  if (!found) throw new Error("the renewals room did not register");
  return found;
};

/** A context that records what the room asked its own service for. */
function stubContext(answer: unknown): ServiceContext & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    call: async (_service: unknown, input: unknown) => {
      asked.push(input);
      return answer;
    },
  } as unknown as ServiceContext & { asked: unknown[] };
}

const tracked = {
  id: "11111111-1111-1111-1111-111111111111",
  contactId: "22222222-2222-2222-2222-222222222222",
  name: "Adobe Creative Cloud",
  costMinor: 5999,
  currency: "USD",
  cycle: "annual" as const,
  customIntervalDays: null,
  firstChargeAt: at("2025-11-19T00:00:00Z"),
  nextRenewalAt: at("2026-11-19T00:00:00Z"),
  alertDays: 3,
  notes: null,
  status: "active" as const,
};

describe("the renewals room", () => {
  it("uses a key the portal's action route will actually accept", () => {
    // `portal.actOnMyRecord` validates the section against /^[a-z]+$/. A
    // camelCase key would list fine and 404 on every action — a split failure
    // that only shows up when somebody tries to stop an alert.
    expect(section().key).toMatch(/^[a-z]+$/);
  });

  it("offers a way in, which a room of someone else's records must not", () => {
    // The register is the one thing in the portal the member creates
    // themselves, so it is the one room with an add link.
    expect(section().add).toEqual({
      href: "/portal/renewals/new",
      labelKey: "renewals.add",
    });
  });

  it("is listed while still empty, or the way in is unreachable", async () => {
    // The nav hides empty rooms, which is right for records the business
    // creates and wrong here: this register starts empty for everybody, so
    // hiding it until it has something in it hides it from exactly the people
    // who need to add the first charge.
    const { portalNavLinks } = await import("@/core/portal/nav");
    const paths = portalNavLinks(
      [
        { key: "renewals", count: 0, addable: true },
        { key: "invoices", count: 0 },
      ],
      { members: false, shop: false },
    ).map((link) => link.path);
    expect(paths).toContain("/portal/renewals");
    // Still hidden, because an empty "Invoices" teaches somebody the portal
    // is broken rather than that they have no invoices.
    expect(paths).not.toContain("/portal/invoices");
  });

  it("asks only for active charges, so an archived one cannot reappear", async () => {
    const ctx = stubContext([tracked]);
    await section().load(ctx, tracked.contactId, 50);
    expect(ctx.asked[0]).toMatchObject({ contactId: tracked.contactId, status: "active" });
  });

  it("shows the cycle rather than the status, which would read 'Active' on every line", async () => {
    const [record] = await section().load(stubContext([tracked]), tracked.contactId, 50);
    expect(record!.statusKey).toBe("renewals.cycle.annual");
    expect(record!.amountMinor).toBe(5999);
    expect(record!.currency).toBe("USD");
    expect(record!.at).toEqual(at("2026-11-19T00:00:00Z"));
    // A session-authenticated record page, never a bearer token.
    expect(record!.href).toBe(`/portal/records/renewals/${tracked.id}`);
  });

  it("answers 'were we told?' from rows rather than from arithmetic", async () => {
    const detail = await section().detail!(
      stubContext({
        subscription: tracked,
        alerts: [
          { id: "a1", renewalAt: at("2026-11-19T00:00:00Z"), daysAhead: 3 },
          { id: "a2", renewalAt: at("2025-11-19T00:00:00Z"), daysAhead: 3 },
        ],
      }),
      tracked.contactId,
      tracked.id,
    );
    const sent = detail.fields!.find((f) => f.labelKey === "renewals.field.alertsSent");
    expect(sent!.value).toBe("2");
    const last = detail.fields!.find((f) => f.labelKey === "renewals.field.lastAlert");
    // ISO-8601 so `formatCustomerValue` can localise it; the field carries the
    // instant and the page decides how to say it.
    expect(last!.value).toBe("2026-11-19T00:00:00.000Z");
  });

  it("does not show an interval row for a charge that has no interval", async () => {
    const detail = await section().detail!(
      stubContext({ subscription: tracked, alerts: [] }),
      tracked.contactId,
      tracked.id,
    );
    expect(detail.fields!.map((f) => f.labelKey)).not.toContain("renewals.field.intervalDays");
    expect(detail.fields!.map((f) => f.labelKey)).not.toContain("renewals.field.notes");
  });

  it("shows the interval for a custom cycle, where it is the only thing that defines it", async () => {
    const detail = await section().detail!(
      stubContext({
        subscription: { ...tracked, cycle: "custom" as const, customIntervalDays: 90 },
        alerts: [],
      }),
      tracked.contactId,
      tracked.id,
    );
    const interval = detail.fields!.find((f) => f.labelKey === "renewals.field.intervalDays");
    expect(interval!.value).toBe("90");
  });

  it("offers stopping the alerts and nothing else", async () => {
    const detail = await section().detail!(
      stubContext({ subscription: tracked, alerts: [] }),
      tracked.contactId,
      tracked.id,
    );
    expect(detail.actions).toEqual(["cancel"]);
  });

  it("refuses an action it does not offer", async () => {
    await expect(
      section().act!(stubContext({}), tracked.contactId, tracked.id, { action: "accept" }),
    ).rejects.toThrow();
  });

  it("sends the member back to the room, not to the record that just left it", async () => {
    // `load` filters to active, so after archiving, the record page would 404.
    const result = await section().act!(
      stubContext({ id: tracked.id, status: "archived" }),
      tracked.contactId,
      tracked.id,
      { action: "cancel" },
    );
    expect(result.href).toBe("/portal/renewals");
  });
});

describe("the renewal-alerts service contracts", () => {
  it("declares an output shape for every service", () => {
    // C3.01: the completeness gate refuses a missing schema, and a service
    // without one can quietly return more than its contract describes.
    for (const service of renewalAlertServices) {
      expect(service.def.output, service.def.name).toBeDefined();
    }
  });

  it("never lets self-service widen what a member may do", () => {
    // The framework enforces this too; asserting it here means a future
    // `selfService` on a mutation fails in this module's own suite.
    for (const service of renewalAlertServices) {
      if (service.def.selfService) expect(service.def.kind, service.def.name).toBe("query");
    }
  });

  it("resolves the contact from the session on every write", () => {
    for (const service of renewalAlertServices) {
      if (service.def.kind !== "mutation") continue;
      expect(service.def.permission, service.def.name).toBe("authenticated");
      // A write that accepted a contact id would take the caller's word for
      // whose register it is.
      expect(Object.keys(service.def.input.shape ?? {}), service.def.name).not.toContain(
        "contactId",
      );
    }
  });

  it("keeps the member's notes out of the audit input", () => {
    // Prose about one's own spending is not audit metadata. Identity and
    // action still come from the authorized mutation itself.
    expect(trackMySubscription.def.auditInputFields).not.toContain("notes");
    expect(trackMySubscription.def.auditInputFields).toContain("name");
  });

  it("refuses money that is not whole minor units", () => {
    const valid = {
      name: "Netflix",
      currency: "usd",
      firstChargeAt: "2026-01-15",
    };
    expect(trackMySubscription.def.input.safeParse({ ...valid, costMinor: 1799 }).success).toBe(
      true,
    );
    // 17.99 is the decimal a person types; it is the form's job to turn that
    // into 1799, and the service's job to refuse it if that did not happen.
    expect(trackMySubscription.def.input.safeParse({ ...valid, costMinor: 17.99 }).success).toBe(
      false,
    );
  });

  it("normalises a currency typed in lower case", () => {
    const parsed = trackMySubscription.def.input.parse({
      name: "Netflix",
      costMinor: 1799,
      currency: "usd",
      firstChargeAt: "2026-01-15",
    });
    expect(parsed.currency).toBe("USD");
    // Defaults a member never has to think about.
    expect(parsed.alertDays).toBe(3);
    expect(parsed.cycle).toBe("monthly");
  });
});

describe("one implementation of the renewal date", () => {
  it("is the same function on both sides, not a copy", async () => {
    const [fromJobs, fromCycle] = await Promise.all([
      import("@/modules/renewal-alerts/jobs"),
      import("@/modules/renewal-alerts/cycle"),
    ]);
    expect(fromJobs.nextRenewalAfter).toBe(fromCycle.nextRenewalAfter);
  });
});
