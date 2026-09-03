// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Google Business Profile hours, reviews and outbound attribution (C9.27).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "@/core/auth/schema";
import { createContact } from "@/core/contacts/service";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { createLocationService, setOpeningHours } from "@/core/locations/service";
import { ready } from "@/core/runtime";
import { campaignFromQuery, identify, track } from "@/modules/analytics/service";
import { invoices } from "@/modules/invoicing/schema";
import { reviews } from "@/modules/reviews/schema";
import {
  assignProfile,
  attributionReport,
  beginOAuth,
  completeOAuth,
  composePackage,
  createVariants,
  publishDue,
  reviewProfile,
  schedulePublications,
  setPolicy,
  syncGbpHours,
  syncGbpReviews,
} from "@/modules/social/service";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const changedEnvironment = new Map<string, string | undefined>();

function environment(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!changedEnvironment.has(name)) changedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
}

function stateFrom(authorizationUrl: string): string {
  return new URL(authorizationUrl).searchParams.get("state")!;
}

function requestJson(init?: RequestInit): Record<string, unknown> {
  const raw = typeof init?.body === "string" ? init.body : "";
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function gbpApi(options?: { hoursBody?: { periods?: unknown }[]; published?: { text?: string } }) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.includes("token")) {
      return new Response(
        JSON.stringify({
          access_token: "gbp-access",
          refresh_token: "gbp-refresh",
          expires_in: 60 * 60 * 24 * 30,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/business.manage",
        }),
        { status: 200 },
      );
    }
    if (method === "PUT" && url.includes("/hours")) {
      options?.hoursBody?.push({ periods: requestJson(init).periods });
      return new Response("{}", { status: 200 });
    }
    if (url.includes("/reviews")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              reviewId: "rev-1",
              starRating: "FIVE",
              comment: "Quiet harbour, easy parking.",
              reviewer: { displayName: "Ada", email: "ada@example.test" },
              createTime: "2026-09-01T12:00:00.000Z",
            },
            {
              reviewId: "rev-2",
              starRating: "FOUR",
              reviewer: { displayName: "Handle Only" },
              createTime: "2026-09-02T12:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/localPosts")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (method === "POST") {
      const text = requestJson(init).text;
      if (options?.published) {
        options.published.text = typeof text === "string" ? text : undefined;
      }
      return new Response(JSON.stringify({ id: "gbp-post-1" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ sub: "gbp-1", name: "Harbour Studio", email: "studio@example.test" }),
      { status: 200 },
    );
  });
}

describe.runIf(hasDatabase)("social GBP", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await ready();
  }, 180_000);

  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner@example.test",
      role: "owner",
    });
    environment({
      APP_URL: "https://freeholder.example",
      GOOGLE_OAUTH_CLIENT_ID: "google-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    });
  }, 60_000);

  afterEach(() => {
    for (const [name, value] of changedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    changedEnvironment.clear();
    resetEnvForTests();
    vi.unstubAllGlobals();
  });

  afterAll(closeDb);

  async function readyGbp() {
    const begun = await beginOAuth.call({ provider: "google_business" }, OWNER);
    vi.stubGlobal("fetch", gbpApi());
    const done = await completeOAuth.call(
      { provider: "google_business", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    await reviewProfile.call({ id: done.id, approved: true }, OWNER);
    await setPolicy.call(
      {
        id: done.id,
        allowRead: true,
        allowRespond: false,
        allowPublish: true,
        approvalPolicy: "none",
      },
      OWNER,
    );
    return done.id;
  }

  it("pushes opening hours from the assigned location", async () => {
    const profileId = await readyGbp();
    const place = await createLocationService.call(
      { name: "Studio", slug: "studio", country: "CA", isPrimary: true },
      OWNER,
    );
    await setOpeningHours.call(
      {
        locationId: place.id,
        entries: [{ weekday: 1, opens: "09:00", closes: "17:00", closed: false }],
      },
      OWNER,
    );
    await assignProfile.call(
      { id: profileId, assignedTo: "locations", locationIds: [place.id] },
      OWNER,
    );
    const hoursBody: { periods?: unknown }[] = [];
    vi.stubGlobal("fetch", gbpApi({ hoursBody }));
    const synced = await syncGbpHours.call({ profileId }, OWNER);
    expect(synced.locations).toBe(1);
    expect(hoursBody[0]).toMatchObject({
      periods: [{ weekday: 1, opens: "09:00", closes: "17:00", closed: false }],
    });
  });

  it("imports GBP reviews into the reviews module once, and emails onto the spine", async () => {
    const profileId = await readyGbp();
    vi.stubGlobal("fetch", gbpApi());
    const first = await syncGbpReviews.call({ profileId }, OWNER);
    expect(first.imported).toBe(2);
    expect(first.skipped).toBe(0);
    const stored = await db().select().from(reviews);
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.source).every((source) => source === "google_business")).toBe(
      true,
    );
    const withEmail = stored.find((row) => row.displayName === "Ada");
    expect(withEmail?.contactId).toBeTruthy();
    const handleOnly = stored.find((row) => row.displayName === "Handle Only");
    expect(handleOnly?.contactId).toBeNull();
    expect(handleOnly?.body).toBe("");

    const second = await syncGbpReviews.call({ profileId }, OWNER);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(await db().select().from(reviews)).toHaveLength(2);
  });

  it("stamps a first-party UTM link on publish and attributes visits, contacts and revenue", async () => {
    const profileId = await readyGbp();
    const published: { text?: string } = {};
    vi.stubGlobal("fetch", gbpApi({ published }));
    const authored = await composePackage.call({ body: "Saturday hours." }, OWNER);
    const [variant] = await createVariants.call(
      { packageId: authored.id, profileIds: [profileId], caption: "Saturday hours." },
      OWNER,
    );
    expect(variant!.status).toBe("approved");
    await schedulePublications.call({ variantIds: [variant!.id] }, OWNER);
    const [publication] = await publishDue.call({}, OWNER);
    expect(publication?.status).toBe("published");
    expect(publication?.canonicalUrl).toContain("utm_medium=social");
    expect(publication?.canonicalUrl).toContain(`utm_campaign=${publication!.id}`);
    expect(published.text).toContain("utm_medium=social");

    const contact = await createContact.call(
      { name: "Ada", email: "visitor@example.test" },
      OWNER,
    );
    const campaign = campaignFromQuery(Object.fromEntries(new URL(publication!.canonicalUrl!).searchParams));
    await track.call(
      {
        anonId: "gbp-visitor",
        sessionId: "gbp-session",
        name: "page.viewed",
        path: "/",
        campaign,
      },
      ANONYMOUS,
    );
    await identify.call({ anonId: "gbp-visitor", contactId: contact.id }, ANONYMOUS);
    await db().insert(invoices).values({
      contactId: contact.id,
      currency: "CAD",
      idempotencyKey: "gbp-attr-1",
      requestHash: "a".repeat(64),
      status: "paid",
      number: "GBP-1",
      issuedAt: new Date(),
      paidAt: new Date(),
      subtotalMinor: 2500,
      totalMinor: 2500,
      paidMinor: 2500,
    });

    const report = await attributionReport.call({ days: 30 }, OWNER);
    expect(report).toEqual([
      expect.objectContaining({
        source: "google_business",
        campaign: publication!.id,
        visitors: 1,
        contacts: 1,
        revenueMinor: 2500,
      }),
    ]);
  });
});
