// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.11 in a real browser.
//
// The events module has had service-level coverage since it was written. What
// it had never had is anybody looking at it: no browser spec, so F06's axe pass
// over the public and admin surfaces was never run, in either theme. The
// third-party findings that arrived on this codebase were almost all of that
// shape — built, tested at the service boundary, broken on the page.
//
// So the assertions here are the ones only a browser can make. A visitor can
// find a published event from the index, the page states how many seats are
// left rather than implying availability, a full session says zero instead of
// going quiet, the calendar link actually returns a calendar, and every surface
// passes WCAG A/AA in light and dark.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { db } from "@/core/db";
import { THEME_COOKIE } from "@/core/design/theme";
import { contacts } from "@/core/contacts/schema";
import { pages } from "@/modules/cms/schema";
import {
  eventRegistrations,
  eventSessions,
  eventTickets,
  events,
} from "@/modules/events/schema";
import { closeDb } from "../helpers/spine";
import { C11_BASE_URL, seedC11Owner, useOwnerSession } from "./owner-session";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SLUG = "intro-to-sourdough";

async function assertAxe(page: Page, surface: string, theme: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    results.violations,
    `${surface} (${theme}) has WCAG A/AA violations:\n${results.violations
      .map((violation) => `${violation.id}: ${violation.help}`)
      .join("\n")}`,
  ).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

test("a published class is findable, states its seats, and hands over a calendar", async ({
  page,
  context,
}) => {
  const token = await seedC11Owner("Fieldnote Bakery");
  await useOwnerSession(context, token);

  // Inserts, not service calls: `owner-session.ts` says why — `service.call`
  // boots the job graph in a way Playwright's test process cannot wire.
  const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);

  const [event] = await db()
    .insert(events)
    .values({
      name: "Intro to sourdough",
      slug: SLUG,
      summary: "Four hours, one loaf each, everything provided.",
      venueName: "The back kitchen",
      venueAddress: "119 Fifth Street, Courtenay",
      status: "published",
      publishedAt: new Date(),
    })
    .returning();
  if (!event) throw new Error("the event fixture was not created");

  // Two seats, so filling it is two registrations rather than a loop.
  const [full] = await db()
    .insert(eventSessions)
    .values({ eventId: event.id, startsAt: starts, endsAt: ends, capacity: 2 })
    .returning();
  const [open] = await db()
    .insert(eventSessions)
    .values({
      eventId: event.id,
      startsAt: new Date(starts.getTime() + 24 * 60 * 60 * 1000),
      endsAt: new Date(ends.getTime() + 24 * 60 * 60 * 1000),
      capacity: 6,
    })
    .returning();
  if (!full || !open) throw new Error("the session fixtures were not created");

  await db()
    .insert(eventTickets)
    .values({ eventId: event.id, name: "General", priceMinor: 6500, currency: "CAD" });

  // Fill the first session, so the page has to say zero rather than stay quiet.
  const [attendee] = await db()
    .insert(contacts)
    .values({ name: "Sam Rivers", email: "sam@example.test" })
    .returning();
  if (!attendee) throw new Error("the contact fixture was not created");
  await db().insert(eventRegistrations).values({
    eventId: event.id,
    sessionId: full.id,
    contactId: attendee.id,
    status: "confirmed",
    quantity: 2,
  });

  // The public pages the publish path would have written.
  await db()
    .insert(pages)
    .values([
      {
        slug: "events",
        title: "Classes",
        status: "published",
        publishedAt: new Date(),
        blocks: [
          { id: "events-h1", type: "heading", props: { text: "Classes", level: 1, align: "start" } },
          { id: "events-list", type: "eventsIndex", props: {} },
        ],
      },
      {
        slug: `events/${SLUG}`,
        title: "Intro to sourdough",
        status: "published",
        publishedAt: new Date(),
        blocks: [
          {
            id: "event-h1",
            type: "heading",
            props: { text: "Intro to sourdough", level: 1, align: "start" },
          },
          { id: "event-detail", type: "eventDetail", props: { eventId: event.id, slug: SLUG } },
        ],
      },
    ]);

  const visitor = await page.context().browser()!.newContext();
  const visitorPage = await visitor.newPage();
  try {
    // The index is how somebody arrives who did not have the link.
    await visitorPage.goto("/events", { waitUntil: "domcontentloaded" });
    await expect(visitorPage.getByRole("link", { name: /Intro to sourdough/i })).toBeVisible();

    await visitorPage.goto(`/events/${SLUG}`, { waitUntil: "domcontentloaded" });
    await expect(visitorPage.getByText(/everything provided/)).toBeVisible();
    // Venue, because "where" is the question a class page most has to answer.
    await expect(visitorPage.getByText(/119 Fifth Street/)).toBeVisible();

    // A sold-out session says zero. Silence would read as availability, which
    // is the reading that wastes somebody's trip.
    await expect(visitorPage.getByText("0 / 2 seats")).toBeVisible();
    await expect(visitorPage.getByText("6 / 6 seats")).toBeVisible();

    for (const theme of ["light", "dark"] as const) {
      await visitor.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
      await visitorPage.goto(`/events/${SLUG}`, { waitUntil: "domcontentloaded" });
      await assertAxe(visitorPage, "public event page", theme);
      await visitorPage.goto("/events", { waitUntil: "domcontentloaded" });
      await assertAxe(visitorPage, "public events index", theme);
    }

    // The calendar link has to produce a calendar, not a page about one.
    const ics = await visitorPage.request.get(`/ics/events/${SLUG}`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const body = await ics.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("Intro to sourdough");

    // A draft event must not be reachable, and the index must not list it.
    await db()
      .insert(events)
      .values({ name: "Unannounced tasting", slug: "unannounced-tasting", status: "draft" });
    await visitorPage.goto("/events", { waitUntil: "domcontentloaded" });
    await expect(visitorPage.getByText(/Unannounced tasting/)).toHaveCount(0);
  } finally {
    await visitor.close();
  }

  // The owner's surfaces, in both themes.
  for (const theme of ["light", "dark"] as const) {
    await context.addCookies([{ name: THEME_COOKIE, value: theme, url: C11_BASE_URL }]);
    await page.goto("/admin/events", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByText(/Intro to sourdough/)).toBeVisible();
    await assertAxe(page, "events list", theme);

    await page.goto(`/admin/events/${event.id}`, { waitUntil: "domcontentloaded" });
    await assertAxe(page, "event detail", theme);
  }
});
