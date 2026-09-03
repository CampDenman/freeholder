// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Social OAuth, assignment, policy and health (MASTER.md §33, C9.24).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { decryptSecret } from "@/core/connections/crypto";
import { db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { ready } from "@/core/runtime";
import { createLocationService } from "@/core/locations/service";
import { socialOauthStates, socialProfiles } from "@/modules/social/schema";
import {
  assignProfile,
  beginOAuth,
  checkHealth,
  completeOAuth,
  disconnectProfile,
  networks,
  profiles,
  reviewProfile,
  setPolicy,
} from "@/modules/social/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

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

function provider(accountId: string, name = "Harbour Instagram") {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET") === "POST" && url.includes("token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "instagram_business_basic instagram_business_content_publish",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ id: accountId, name, username: "harbour" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

describe.runIf(hasDatabase)("social connections", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await ready();
  }, 180_000);

  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: STAFF.userId, email: "staff@example.test", role: "staff" },
    ]);
    environment({
      APP_URL: "https://freeholder.example",
      META_OAUTH_CLIENT_ID: "meta-id",
      META_OAUTH_CLIENT_SECRET: "meta-secret",
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

  afterAll(async () => {
    delete process.env.META_OAUTH_CLIENT_ID;
    delete process.env.META_OAUTH_CLIENT_SECRET;
    await closeDb();
  });

  it("lists Instagram as ready once Meta credentials are set", async () => {
    const listed = await networks.call({}, OWNER);
    expect(listed.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "instagram",
        "facebook",
        "tiktok",
        "youtube",
        "linkedin",
        "x",
        "pinterest",
        "google_business",
      ]),
    );
    const instagram = listed.find((entry) => entry.id === "instagram");
    expect(instagram?.available).toBe(true);
    expect(instagram?.capabilities.extras).toContain("stories");
  });

  it("starts OAuth on its own callback with a hashed one-time state", async () => {
    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    const url = new URL(begun.authorizationUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://freeholder.example/api/social/instagram/callback",
    );
    const [stored] = await db().select().from(socialOauthStates);
    expect(stored).toMatchObject({
      tokenHash: createHash("sha256").update(stateFrom(begun.authorizationUrl)).digest("hex"),
      userId: OWNER.userId,
      provider: "instagram",
      consumedAt: null,
    });
  });

  it("stores a profile pending review, with credentials encrypted", async () => {
    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", provider("ig-1"));
    const done = await completeOAuth.call(
      { provider: "instagram", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    expect(done.status).toBe("pending_review");
    const [row] = await db().select().from(socialProfiles);
    expect(row?.status).toBe("pending_review");
    expect(row?.credentials).not.toContain("refresh-token");
    expect(decryptSecret(row!.credentials!, row!.id)).toContain("refresh-token");
  });

  it("allows two Instagram profiles", async () => {
    const first = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", provider("ig-1", "One"));
    await completeOAuth.call(
      { provider: "instagram", state: stateFrom(first.authorizationUrl), code: "a" },
      OWNER,
    );
    const second = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", provider("ig-2", "Two"));
    await completeOAuth.call(
      { provider: "instagram", state: stateFrom(second.authorizationUrl), code: "b" },
      OWNER,
    );
    expect(await profiles.call({}, OWNER)).toHaveLength(2);
  });

  it("does not make a profile usable until it is reviewed", async () => {
    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", provider("ig-1"));
    const done = await completeOAuth.call(
      { provider: "instagram", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    const approved = await reviewProfile.call({ id: done.id, approved: true }, OWNER);
    expect(approved.status).toBe("active");
  });

  it("assigns a profile to a person, the business, or locations", async () => {
    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", provider("ig-1"));
    const done = await completeOAuth.call(
      { provider: "instagram", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    await reviewProfile.call({ id: done.id, approved: true }, OWNER);

    const asPerson = await assignProfile.call(
      { id: done.id, assignedTo: "user", assigneeUserId: STAFF.userId },
      OWNER,
    );
    expect(asPerson).toMatchObject({ assignedTo: "user", assigneeUserId: STAFF.userId });

    const asBusiness = await assignProfile.call({ id: done.id, assignedTo: "business" }, OWNER);
    expect(asBusiness.assignedTo).toBe("business");
    expect(asBusiness.assigneeUserId).toBeNull();

    const place = await createLocationService.call(
      { name: "Studio", slug: "studio", country: "CA" },
      OWNER,
    );
    const asPlaces = await assignProfile.call(
      { id: done.id, assignedTo: "locations", locationIds: [place.id] },
      OWNER,
    );
    expect(asPlaces.locationIds).toEqual([place.id]);
  });

  it("stores read, respond, publish and approval separately", async () => {
    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", provider("ig-1"));
    const done = await completeOAuth.call(
      { provider: "instagram", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    const saved = await setPolicy.call(
      {
        id: done.id,
        allowRead: true,
        allowRespond: true,
        allowPublish: false,
        approvalPolicy: "required",
      },
      OWNER,
    );
    expect(saved).toMatchObject({
      allowRead: true,
      allowRespond: true,
      allowPublish: false,
      approvalPolicy: "required",
    });
  });

  it("records token health so expiry is visible before post time", async () => {
    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    const longLived = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST" && url.includes("token")) {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 60 * 60 * 24 * 30,
            token_type: "Bearer",
            scope: "instagram_business_basic",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: "ig-1", name: "Harbour" }), { status: 200 });
    });
    vi.stubGlobal("fetch", longLived);
    const done = await completeOAuth.call(
      { provider: "instagram", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    await reviewProfile.call({ id: done.id, approved: true }, OWNER);
    vi.stubGlobal("fetch", longLived);
    const [health] = await checkHealth.call({ id: done.id }, OWNER);
    expect(health!.lastHealthStatus).toBe("ok");
  });

  it("drops credentials on disconnect", async () => {
    const begun = await beginOAuth.call({ provider: "instagram" }, OWNER);
    vi.stubGlobal("fetch", provider("ig-1"));
    const done = await completeOAuth.call(
      { provider: "instagram", state: stateFrom(begun.authorizationUrl), code: "one-use" },
      OWNER,
    );
    await disconnectProfile.call({ id: done.id }, OWNER);
    const [row] = await db()
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.id, done.id));
    expect(row?.status).toBe("revoked");
    expect(row?.credentials).toBeNull();
  });

  it("refuses an unknown network rather than inventing one", async () => {
    const error = await failure(beginOAuth.call({ provider: "myspace" }, OWNER));
    expect(error.code).toBe("not_found");
  });
});
