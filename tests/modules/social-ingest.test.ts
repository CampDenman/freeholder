// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Ingest owned social posts into packages (MASTER.md §33, C9.25).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { conversations, messages } from "@/core/messaging/schema";
import { assets } from "@/core/media/schema";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import {
  beginOAuth,
  completeOAuth,
  draftFromPackage,
  ingestProfile,
  interactionList,
  packageList,
  reviewProfile,
  setPolicy,
} from "@/modules/social/service";
import { socialPublications } from "@/modules/social/schema";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

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

async function pngBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 80, b: 40 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

function api(png: Uint8Array<ArrayBuffer>) {
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
          scope: "instagram_business_basic instagram_business_manage_comments",
        }),
        { status: 200 },
      );
    }
    if (url.includes("/media") && method === "GET") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "post-1",
              caption: "Harbour at dusk",
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
    if (url.includes("/comments") && method === "GET") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "c-email",
              text: "We would like a quote.",
              username: "sam",
              email: "sam@example.com",
              timestamp: "2026-09-01T19:00:00.000Z",
            },
            {
              id: "c-handle",
              text: "Nice light.",
              username: "anon_handle",
              timestamp: "2026-09-01T19:05:00.000Z",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("cdn.example") || url.endsWith(".png")) {
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    }
    return new Response(JSON.stringify({ id: "ig-1", name: "Harbour", username: "harbour" }), {
      status: 200,
    });
  });
}

describe.runIf(hasDatabase)("social ingest", { timeout: 60_000 }, () => {
  let png: Uint8Array<ArrayBuffer>;

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

  async function connectedProfile() {
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
        allowRespond: true,
        allowPublish: false,
        approvalPolicy: "required",
      },
      OWNER,
    );
    return done.id;
  }

  it("reclaims an owned post into a package and an asset with checksum provenance", async () => {
    const profileId = await connectedProfile();
    vi.stubGlobal("fetch", api(png));
    const result = await ingestProfile.call({ profileId }, OWNER);
    expect(result.packagesCreated).toBe(1);

    const [pack] = await packageList.call({}, OWNER);
    expect(pack).toMatchObject({
      sourceKind: "ingest",
      sourceRef: "post-1",
      body: "Harbour at dusk",
      rights: "owned",
    });
    expect(pack!.assetIds).toHaveLength(1);
    const [asset] = await db()
      .select()
      .from(assets)
      .where(eq(assets.id, pack!.assetIds[0]!));
    expect(asset?.source).toBe("import");
    expect(asset?.checksumSha256).toHaveLength(64);
    expect(JSON.stringify(asset?.provenance)).toContain("instagram");
  });

  it("does not ingest the same provider post twice", async () => {
    const profileId = await connectedProfile();
    vi.stubGlobal("fetch", api(png));
    await ingestProfile.call({ profileId }, OWNER);
    vi.stubGlobal("fetch", api(png));
    const second = await ingestProfile.call({ profileId }, OWNER);
    expect(second.packagesCreated).toBe(0);
    expect(second.packagesSeen).toBe(1);
    expect(await packageList.call({}, OWNER)).toHaveLength(1);
    const pubs = await db().select().from(socialPublications);
    expect(pubs).toHaveLength(1);
  });

  it("routes a comment with an email onto the spine, and leaves a handle-only comment off it", async () => {
    const profileId = await connectedProfile();
    vi.stubGlobal("fetch", api(png));
    await ingestProfile.call({ profileId }, OWNER);
    const threads = await interactionList.call({}, OWNER);
    expect(threads).toHaveLength(2);
    const withEmail = threads.find((row) => row.authorEmail === "sam@example.com");
    const handleOnly = threads.find((row) => row.authorHandle === "anon_handle");
    expect(withEmail?.contactId).toBeTruthy();
    expect(withEmail?.conversationId).toBeTruthy();
    expect(handleOnly?.contactId).toBeNull();
    expect(handleOnly?.conversationId).toBeNull();

    const [person] = await db()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "sam@example.com"));
    expect(person).toBeTruthy();
    const thread = await db()
      .select()
      .from(conversations)
      .where(eq(conversations.id, withEmail!.conversationId!));
    expect(thread[0]?.replyChannel).toBe("social");
    const inbound = await db()
      .select()
      .from(messages)
      .where(eq(messages.providerRef, "c-email"));
    expect(inbound).toHaveLength(1);
  });

  it("turns an ingested post into a draft without copy-paste", async () => {
    const profileId = await connectedProfile();
    vi.stubGlobal("fetch", api(png));
    await ingestProfile.call({ profileId }, OWNER);
    const [source] = await packageList.call({}, OWNER);
    const draft = await draftFromPackage.call({ id: source!.id }, OWNER);
    expect(draft.sourceKind).toBe("draft");
    expect(draft.parentPackageId).toBe(source!.id);
    expect(draft.body).toBe(source!.body);
    expect(draft.assetIds).toEqual(source!.assetIds);
  });

  it("refuses ingest on a profile that may not be read", async () => {
    const profileId = await connectedProfile();
    await setPolicy.call(
      {
        id: profileId,
        allowRead: false,
        allowRespond: false,
        allowPublish: false,
        approvalPolicy: "required",
      },
      OWNER,
    );
    const error = await failure(ingestProfile.call({ profileId }, OWNER));
    expect(error.code).toBe("permission");
  });
});
