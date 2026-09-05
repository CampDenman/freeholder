// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Compose, review, schedule and publish (MASTER.md §33, C9.26).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import {
  beginOAuth,
  completeOAuth,
  composePackage,
  createVariants,
  packageList,
  publicationCalendar,
  reviewProfile,
  reviewVariant,
  runPublication,
  runProfileIngest,
  schedulePublications,
  setPolicy,
} from "@/modules/social/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const changedEnvironment = new Map<string, string | undefined>();
const downloadSocialMedia = vi.hoisted(() => vi.fn());

vi.mock("@/adapters/social/media", () => ({ downloadSocialMedia }));

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

async function pngBytes(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 80, g: 20, b: 20 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

function api(png: Uint8Array, publishedId = "net-1") {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.includes("token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 60 * 60 * 24 * 30,
          token_type: "Bearer",
          scope: "instagram_business_basic instagram_business_content_publish",
        }),
        { status: 200 },
      );
    }
    if (method === "POST") {
      return new Response(JSON.stringify({ id: publishedId, url: "https://ig.example/p/1" }), {
        status: 200,
      });
    }
    if (url.includes("/media")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "post-1",
              caption: "Harbour at dusk #harbour",
              permalink: "https://instagram.example/p/post-1",
              timestamp: "2026-09-01T18:00:00.000Z",
              media_url: "https://cdn.example/post-1.png",
              mime: "image/png",
              filename: "harbour.png",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/comments")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (url.includes("cdn.example") || url.endsWith(".png")) {
      return new Response(Buffer.from(png), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    return new Response(JSON.stringify({ id: "ig-1", name: "Harbour" }), { status: 200 });
  });
}

describe.runIf(hasDatabase)("social composer", { timeout: 60_000 }, () => {
  let png: Uint8Array;

  beforeAll(async () => {
    await ready();
    png = await pngBytes();
  }, 180_000);

  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values({
      id: OWNER.userId,
      email: "owner@example.test",
      role: "owner",
    });
    downloadSocialMedia.mockResolvedValue(png);
    environment({
      APP_URL: "https://freeholder.example",
      META_OAUTH_CLIENT_ID: "meta-id",
      META_OAUTH_CLIENT_SECRET: "meta-secret",
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

  afterAll(async () => {
    await closeDb();
  });

  async function readyProfile() {
    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", api(png));
    const done = await completeOAuth.call(
      { provider: "instagram", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    await reviewProfile.call({ id: done.id, approved: true }, OWNER);
    await setPolicy.call(
      {
        id: done.id,
        allowRead: true,
        allowRespond: false,
        allowPublish: true,
        approvalPolicy: "required",
      },
      OWNER,
    );
    return done.id;
  }

  it("makes a generated crop that must be reviewed before it can be scheduled", async () => {
    const profileId = await readyProfile();
    vi.stubGlobal("fetch", api(png));
    await runProfileIngest(profileId);
    const [pack] = await packageList.call({}, OWNER);
    const [variant] = await createVariants.call(
      { packageId: pack!.id, profileIds: [profileId] },
      OWNER,
    );
    expect(variant!.generated).toBe(true);
    expect(variant!.status).toBe("pending_review");
    expect(variant!.aspectRatio).toBe("4:5");
    expect(variant!.hashtags).toContain("harbour");

    const blocked = await failure(
      schedulePublications.call({ variantIds: [variant!.id] }, OWNER),
    );
    expect(blocked.code).toBe("conflict");

    const approved = await reviewVariant.call({ id: variant!.id, approved: true }, OWNER);
    expect(approved.status).toBe("approved");
  });

  it("publishes an approved variant once, even if schedule is asked twice", async () => {
    const profileId = await readyProfile();
    vi.stubGlobal("fetch", api(png));
    await runProfileIngest(profileId);
    const [pack] = await packageList.call({}, OWNER);
    const [variant] = await createVariants.call(
      { packageId: pack!.id, profileIds: [profileId] },
      OWNER,
    );
    await reviewVariant.call({ id: variant!.id, approved: true }, OWNER);
    const when = "2020-01-01T00:00:00.000Z";
    vi.stubGlobal("fetch", api(png, "net-unique"));
    const first = await schedulePublications.call(
      { variantIds: [variant!.id], publishAt: when },
      OWNER,
    );
    const second = await schedulePublications.call(
      { variantIds: [variant!.id], publishAt: when },
      OWNER,
    );
    expect(second[0]!.id).toBe(first[0]!.id);
    await runPublication(first[0]!.id);
    const calendar = await publicationCalendar.call({}, OWNER);
    const published = calendar.filter((row) => row.status === "published");
    expect(published).toHaveLength(1);
    expect(published[0]!.providerRef).toBe("net-unique");
  });

  it("records a durable failure when a scheduled destination becomes unavailable", async () => {
    const profileId = await readyProfile();
    vi.stubGlobal("fetch", api(png));
    await runProfileIngest(profileId);
    const [pack] = await packageList.call({}, OWNER);
    const [variant] = await createVariants.call(
      { packageId: pack!.id, profileIds: [profileId] },
      OWNER,
    );
    await reviewVariant.call({ id: variant!.id, approved: true }, OWNER);
    const [publication] = await schedulePublications.call(
      { variantIds: [variant!.id], publishAt: "2020-01-01T00:00:00.000Z" },
      OWNER,
    );
    await setPolicy.call(
      {
        id: profileId,
        allowRead: true,
        allowRespond: false,
        allowPublish: false,
        approvalPolicy: "required",
      },
      OWNER,
    );

    await expect(runPublication(publication!.id)).rejects.toThrow("publishing is disabled");
    const calendar = await publicationCalendar.call({}, OWNER);
    expect(calendar.find((row) => row.id === publication!.id)).toMatchObject({
      status: "failed",
      lastError: "The publishing profile is unavailable or publishing is disabled.",
    });
  });

  it("composes an authored package without ingesting first", async () => {
    const authored = await composePackage.call({ body: "Studio open Saturday." }, OWNER);
    expect(authored.contentDigest).toHaveLength(64);
  });
});
