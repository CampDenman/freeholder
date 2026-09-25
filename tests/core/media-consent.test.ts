// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C8.16: permission to publish somebody's likeness, and what survives taking
// it back.
//
// The first test is the one this change exists for. The previous
// implementation set three columns on the project back to NULL, so after a
// withdrawal a clinic could no longer show that it had published lawfully for
// the six months before — the evidence disappeared at the moment it started
// mattering. Here the grant is still there afterwards, and that is asserted
// rather than assumed.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { db } from "@/core/db";
import { contacts } from "@/core/contacts/schema";
import { projects, projectFiles } from "@/modules/projects/schema";
import { assets } from "@/core/media/schema";
import { attachFile } from "@/modules/projects/service";
import { sweepLapsedConsent } from "@/modules/projects/publishing-service";
import { eq } from "drizzle-orm";
import {
  grantMediaConsent,
  mediaConsentHistory,
  mediaConsentState,
  withdrawMediaConsent,
} from "@/core/privacy/media-consent";
import {
  CUSTOMER,
  OWNER,
  closeDb,
  failure,
  hasDatabase,
  truncateSpine,
} from "../helpers/spine";

const WORK = "11111111-1111-4111-8111-111111111111";

describe.runIf(hasDatabase)("media consent", () => {
  beforeAll(async () => {
    await ready();
  }, 120_000);
  afterAll(async () => {
    await closeDb();
  });

  let contactId: string;
  beforeEach(async () => {
    await truncateSpine();
    const [person] = await db()
      .insert(contacts)
      .values({ name: "Alex Rivera", email: "alex@example.test" })
      .returning();
    contactId = person!.id;
  });

  async function grant(extra: Record<string, unknown> = {}) {
    return grantMediaConsent.call(
      {
        contactId,
        subjectKind: "project",
        subjectId: WORK,
        method: "written",
        note: "Signed release on file.",
        ...extra,
      },
      OWNER,
    );
  }

  it("keeps the grant after it is taken back", async () => {
    await grant();
    expect((await mediaConsentState.call({ subjectKind: "project", subjectId: WORK }, OWNER)).live).toBe(true);

    await withdrawMediaConsent.call(
      { subjectKind: "project", subjectId: WORK, method: "email", note: "Asked us to stop." },
      OWNER,
    );

    const state = await mediaConsentState.call(
      { subjectKind: "project", subjectId: WORK },
      OWNER,
    );
    expect(state.live).toBe(false);
    expect(state.reason).toBe("withdrawn");

    // The point: the original permission is still on the record, with the
    // method and the note it was given under.
    const history = await mediaConsentHistory.call(
      { subjectKind: "project", subjectId: WORK },
      OWNER,
    );
    expect(history).toHaveLength(2);
    const granted = history.find((entry) => entry.state === "granted");
    expect(granted).toBeDefined();
    expect(granted!.method).toBe("written");
    expect(granted!.note).toBe("Signed release on file.");
  });

  it("treats consent nobody gave, consent withdrawn and consent lapsed as the same answer", async () => {
    const never = await mediaConsentState.call(
      { subjectKind: "project", subjectId: WORK },
      OWNER,
    );
    expect(never.live).toBe(false);
    expect(never.reason).toBe("none");

    await grant({
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    const lapsed = await mediaConsentState.call(
      { subjectKind: "project", subjectId: WORK },
      OWNER,
    );
    // Consent that quietly ran out reads exactly like consent that still
    // holds, unless something says otherwise. This says otherwise.
    expect(lapsed.live).toBe(false);
    expect(lapsed.reason).toBe("lapsed");
  });

  it("does not let a grant lapse before it was given", async () => {
    const error = await failure(
      grant({
        effectiveAt: new Date("2026-02-01T00:00:00.000Z"),
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );
    expect(error.code).toBe("validation");
  });

  it("can be given again after it was taken back", async () => {
    await grant();
    await withdrawMediaConsent.call(
      { subjectKind: "project", subjectId: WORK, method: "email" },
      OWNER,
    );
    await grant({ method: "contract", note: "Signed again." });

    const state = await mediaConsentState.call(
      { subjectKind: "project", subjectId: WORK },
      OWNER,
    );
    expect(state.live).toBe(true);
    expect(state.decision!.method).toBe("contract");
    // Three decisions, all of which really happened.
    expect(
      await mediaConsentHistory.call({ subjectKind: "project", subjectId: WORK }, OWNER),
    ).toHaveLength(3);
  });

  it("refuses to take back a permission nobody gave", async () => {
    const error = await failure(
      withdrawMediaConsent.call(
        { subjectKind: "project", subjectId: WORK, method: "email" },
        OWNER,
      ),
    );
    expect(error.code).toBe("not_found");
  });

  it("orders by when a decision took effect, not when it was typed", async () => {
    // A withdrawal that happened last week, entered today, must still outrank
    // a grant from a month ago — and a late data-entry correction must not
    // silently reinstate permission somebody took back.
    await grant({ effectiveAt: new Date("2026-03-01T00:00:00.000Z") });
    await withdrawMediaConsent.call(
      {
        subjectKind: "project",
        subjectId: WORK,
        method: "verbal",
        effectiveAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      OWNER,
    );
    await grant({
      method: "form",
      effectiveAt: new Date("2026-02-01T00:00:00.000Z"),
      note: "Entered late, from an older form.",
    });

    const state = await mediaConsentState.call(
      { subjectKind: "project", subjectId: WORK },
      OWNER,
    );
    expect(state.live).toBe(false);
    expect(state.reason).toBe("withdrawn");
  });

  it("takes published work offline the moment its permission stops standing", async () => {
    const [work] = await db()
      .insert(projects)
      .values({
        title: "Kitchen refit",
        slug: "kitchen-refit",
        contactId,
        status: "active",
        publicationStatus: "published",
        publishedAt: new Date("2026-01-02T00:00:00.000Z"),
      })
      .returning();

    // Permission given for January only, and January is over.
    await grantMediaConsent.call(
      {
        contactId,
        subjectKind: "project",
        subjectId: work!.id,
        method: "written",
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-02-01T00:00:00.000Z"),
      },
      OWNER,
    );

    // The publish gate refuses lapsed consent, but a gate only fires when
    // somebody pushes on it. Nobody is pushing; the page is simply still up.
    const before = await db().select().from(projects).where(eq(projects.id, work!.id));
    expect(before[0]!.publicationStatus).toBe("published");

    const swept = await sweepLapsedConsent.call({}, { kind: "system" });
    expect(swept.unpublished).toBe(1);

    const after = await db().select().from(projects).where(eq(projects.id, work!.id));
    expect(after[0]!.publicationStatus).toBe("draft");
    expect(after[0]!.publishedAt).toBeNull();
  });

  it("leaves work alone while its permission still stands", async () => {
    const [work] = await db()
      .insert(projects)
      .values({
        title: "Bathroom",
        slug: "bathroom",
        contactId,
        status: "active",
        publicationStatus: "published",
        publishedAt: new Date("2026-01-02T00:00:00.000Z"),
      })
      .returning();
    await grantMediaConsent.call(
      { contactId, subjectKind: "project", subjectId: work!.id, method: "written" },
      OWNER,
    );
    const swept = await sweepLapsedConsent.call({}, { kind: "system" });
    expect(swept.unpublished).toBe(0);
    const after = await db().select().from(projects).where(eq(projects.id, work!.id));
    expect(after[0]!.publicationStatus).toBe("published");
  });

  it("orders a progress series by when each picture was taken", async () => {
    const [work] = await db()
      .insert(projects)
      .values({ title: "Aligner course", slug: "aligner-course", contactId, status: "active" })
      .returning();
    const made = await Promise.all(
      ["week-0.jpg", "week-12.jpg"].map(async (filename) => {
        const [asset] = await db()
          .insert(assets)
          .values({
            kind: "image",
            storageKey: `fixtures/${filename}`,
            filename,
            mime: "image/jpeg",
            bytes: 1024,
            legacyBytes: 1024,
          })
          .returning();
        return asset!;
      }),
    );

    // Filed in the wrong order on purpose: the later picture is uploaded first.
    await attachFile.call(
      {
        projectId: work!.id,
        assetId: made[1]!.id,
        role: "series",
        seriesKey: "aligners",
        capturedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
      OWNER,
    );
    await attachFile.call(
      {
        projectId: work!.id,
        assetId: made[0]!.id,
        role: "series",
        seriesKey: "aligners",
        capturedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      OWNER,
    );

    const steps = await db()
      .select()
      .from(projectFiles)
      .where(eq(projectFiles.projectId, work!.id))
      .orderBy(projectFiles.capturedAt);
    expect(steps).toHaveLength(2);
    // Ordered by the date on the picture, not the order somebody filed them.
    expect(steps[0]!.capturedAt!.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(steps[0]!.seriesKey).toBe("aligners");
  });

  it("refuses a progress step with no date, and a date on something that is not one", async () => {
    const [work] = await db()
      .insert(projects)
      .values({ title: "Recovery", slug: "recovery", contactId, status: "active" })
      .returning();
    const [asset] = await db()
      .insert(assets)
      .values({
        kind: "image",
        storageKey: "fixtures/step.jpg",
        filename: "step.jpg",
        mime: "image/jpeg",
        bytes: 512,
        legacyBytes: 512,
      })
      .returning();

    const undated = await failure(
      attachFile.call(
        { projectId: work!.id, assetId: asset!.id, role: "series", seriesKey: "recovery" },
        OWNER,
      ),
    );
    expect(undated.code).toBe("validation");
    expect(undated.message).toContain("date it was taken");

    const stray = await failure(
      attachFile.call(
        { projectId: work!.id, assetId: asset!.id, role: "gallery", seriesKey: "recovery" },
        OWNER,
      ),
    );
    expect(stray.code).toBe("validation");
  });

  it("keeps consent behind a grant", async () => {
    expect(
      (
        await failure(
          grantMediaConsent.call(
            {
              contactId,
              subjectKind: "project",
              subjectId: WORK,
              method: "written",
            },
            CUSTOMER,
          ),
        )
      ).code,
    ).toBe("permission");
  });
});
