// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.40. The two pure parts of renewal alerts: when the next charge falls,
// and what the person reads.
//
// Each test names the behaviour it is preventing rather than merely asserting
// the current one.
import { describe, expect, it } from "vitest";
import { nextRenewalAfter } from "@/modules/renewal-alerts/jobs";
import { renewalAlertMessage } from "@/modules/renewal-alerts/mail";

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
