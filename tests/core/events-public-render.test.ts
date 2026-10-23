// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public event blocks as a visitor reads them (C6.11): dates in the zone
// the event happens in, seats in words, finished events filed as past.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BlockRenderContext } from "@/modules/cms/blocks/types";
import en from "../../locales/en.json";

vi.mock("../../app/(public)/event-actions", () => ({ registerForEventAction: async () => undefined }));

const { eventDetail, eventsIndex } = await import("@/modules/events/blocks");

const messages = en as Record<string, string>;
const ctx: BlockRenderContext = {
  locale: "en",
  t: (key: string, values?: Record<string, string | number | Date>) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) =>
      values && name in values ? String(values[name]) : `{${name}}`),
  business: null,
  path: "/events/golden-hour-workshop",
};

const DAY = 24 * 60 * 60 * 1000;

function event(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "729a66c4-21a7-47ec-ad1e-7b0f7288bb11",
    name: "Golden-hour beach workshop",
    slug: "golden-hour-workshop",
    summary: "Two hours on Goose Spit.",
    venueName: "Aurora Coast studio",
    venueAddress: null,
    venueLocationId: null,
    status: "published",
    seo: {},
    workingName: null,
    workingSummary: null,
    workingVenueName: null,
    workingVenueAddress: null,
    workingSeo: null,
    version: 2,
    publishedAt: now,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    tickets: [],
    sessions: [
      {
        id: "d943b228-de60-4892-b304-cf83d920850c",
        eventId: "729a66c4-21a7-47ec-ad1e-7b0f7288bb11",
        startsAt: new Date("2099-11-09T00:00:00.000Z"),
        endsAt: new Date("2099-11-09T02:00:00.000Z"),
        timezone: "America/Vancouver",
        capacity: 8,
        waitlistEnabled: true,
        remaining: 3,
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  };
}

function draw(block: typeof eventDetail | typeof eventsIndex, resolved: unknown): string {
  return renderToStaticMarkup(block.render({ props: {}, resolved, ctx } as never) as never);
}

describe("public event page", () => {
  it("reads the session in its own zone with a machine-readable start, and seats in words", () => {
    const html = draw(eventDetail, event());
    expect(html).not.toContain(">2099-11-09T00:00:00.000Z<");
    expect(html).toContain('dateTime="2099-11-09T00:00:00.000Z"');
    // 00:00 UTC on 9 November is 4 PM the evening before on the coast.
    expect(html).toMatch(/Sun, Nov 8, 4:00\s*[–-]\s*6:00\sPM PST/);
    expect(html).toContain("3 of 8 seats left");
    expect(html).toContain('href="/ics/events/golden-hour-workshop"');
  });

  it("names a finished event as finished, offers no form, and does not count seats", () => {
    const html = draw(
      eventDetail,
      event({
        sessions: [
          {
            ...event().sessions[0]!,
            startsAt: new Date(Date.now() - 3 * DAY),
            endsAt: new Date(Date.now() - 3 * DAY + 7_200_000),
          },
        ],
      }),
    );
    expect(html).toContain("This event has finished.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("seats left");
  });

  it("gives each rendered form its own submission token", () => {
    const token = (html: string) => /name="submissionToken" value="([A-Za-z0-9_-]{32})"/.exec(html)?.[1];
    const first = token(draw(eventDetail, event()));
    const second = token(draw(eventDetail, event()));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("says plainly when the email is already registered, with no invoice link", () => {
    const html = renderToStaticMarkup(
      eventDetail.render({
        props: {},
        resolved: event(),
        ctx: { ...ctx, query: { eventAlreadyRegistered: "golden-hour-workshop" } },
      } as never) as never,
    );
    expect(html).toContain("already registered for this session");
    expect(html).not.toContain("/portal/invoices/");
  });
});

describe("public events list", () => {
  const listed = (slug: string, next: Date | null, endedAt: Date | null) => ({
    ...event({ slug, name: slug }),
    nextStartsAt: next,
    nextEndsAt: next ? new Date(next.getTime() + 7_200_000) : null,
    nextTimezone: next ? "America/Vancouver" : null,
    endedAt,
  });

  it("files finished events under Past events and dates the upcoming ones", () => {
    const html = draw(eventsIndex, [
      listed("winter-portrait-day", new Date("2099-12-05T18:00:00Z"), null),
      listed("autumn-open-studio", null, new Date(Date.now() - DAY)),
    ]);
    const past = html.indexOf("Past events");
    expect(past).toBeGreaterThan(html.indexOf("/events/winter-portrait-day"));
    expect(html.indexOf("/events/autumn-open-studio")).toBeGreaterThan(past);
    expect(html).toMatch(/Sat, Dec 5, 10:00\sAM\s*[–-]\s*12:00\sPM PST/);
  });

  it("says so when nothing is ahead", () => {
    const html = draw(eventsIndex, [listed("autumn-open-studio", null, new Date(Date.now() - DAY))]);
    expect(html).toContain("No upcoming events right now.");
  });
});
