// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.30: an upload that matches known abuse imagery is held, never served,
// kept as evidence the owner cannot delete or release by rescanning, tied to
// its uploader (who is suspended pending review), and listed for the owner
// to report. A fake matching list stands in for PhotoDNA here.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { ready } from "@/core/runtime";
import { rescanAsset, trashAsset, uploadAsset } from "@/core/media/service";
import { createCompositeScanner, resetMalwareScannerForTests, setMalwareScannerForTests } from "@/adapters/malware";
import { noMalwareScanner } from "@/adapters/malware/none";
import { joinSite } from "@/modules/members/service";
import { abuseReportQueue, linkAbuseReports, markAbuseReported } from "@/modules/members/abuse";
import { abuseReports, memberProfiles } from "@/modules/members/schema";
import { closeDb, CUSTOMER, failure, hasDatabase, OWNER, STAFF, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const image = async (r: number) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 10, b: 10 } } }).jpeg().toBuffer());

describe.runIf(hasDatabase)("known abuse imagery on upload (C12.30)", () => {
  let known: Uint8Array;
  beforeAll(async () => {
    await ready();
    known = await image(200);
  }, 60_000);
  beforeEach(async () => {
    const listed = createHash("sha256").update(known).digest("hex");
    setMalwareScannerForTests(createCompositeScanner(noMalwareScanner, {
      id: "photodna",
      missing: () => [],
      match: async ({ bytes }) => (createHash("sha256").update(bytes).digest("hex") === listed ? { matched: true, matchId: "trk_test" } : { matched: false }),
    }));
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: STAFF.userId, email: "staff@example.test", role: "staff" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
    ]);
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
  });
  afterEach(() => resetMalwareScannerForTests());
  afterAll(closeDb);

  it("holds a match as evidence, suspends the uploader, and lets only the owner report it", async () => {
    const ordinary = await uploadAsset.call({ filename: "harbour.jpg", contentType: "image/jpeg", bytes: await image(30) }, RAE);
    expect(ordinary.status).toBe("ready");

    const held = await uploadAsset.call({ filename: "x.jpg", contentType: "image/jpeg", bytes: known }, RAE);
    expect(held.status).toBe("quarantined");
    const [report] = await db().select().from(abuseReports);
    expect(report).toMatchObject({ provider: "photodna", matchId: "trk_test", sha256: createHash("sha256").update(known).digest("hex"), state: "to_report" });
    expect(JSON.stringify(report)).not.toContain(Buffer.from(known).toString("base64").slice(0, 40));

    expect(await linkAbuseReports.call({}, { kind: "system" })).toEqual({ linked: 1, suspended: 1 });
    expect((await db().select({ status: memberProfiles.status }).from(memberProfiles).where(eq(memberProfiles.userId, RAE.userId)))[0]?.status).toBe("suspended");

    // Evidence cannot be deleted, or released by a later scan.
    expect((await failure(trashAsset.call({ id: held.id }, OWNER))).code).toBe("conflict");
    expect((await failure(rescanAsset.call({ id: held.id }, OWNER))).code).toBe("conflict");

    expect((await failure(abuseReportQueue.call({}, STAFF))).code).toBe("permission");
    const [item] = await abuseReportQueue.call({}, OWNER);
    expect(item).toMatchObject({ assetId: held.id, uploader: "@rae", matchId: "trk_test" });
    await markAbuseReported.call({ id: item!.id, reportedTo: "cybertip", reference: "CT-2026-000123" }, OWNER);
    expect(await abuseReportQueue.call({}, OWNER)).toEqual([]);
    expect((await abuseReportQueue.call({ state: "reported" }, OWNER))[0]).toMatchObject({ reportedTo: "cybertip", reportReference: "CT-2026-000123" });
  });
});
