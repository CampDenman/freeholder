// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Grounding the front-site assistant (MASTER.md §31, C9.22).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { createPage, publishPage } from "@/modules/cms/service";
import {
  createLocationService,
  setOpeningHours,
} from "@/core/locations/service";
import { embedText } from "@/modules/assistant/embed";
import { retrieveNotes } from "@/modules/assistant/retrieve";
import { db } from "@/core/db";
import {
  deleteKnowledge,
  knowledgeList,
  reindex,
  saveKnowledge,
} from "@/modules/assistant/service";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const BUSINESS = {
  name: "Harbour Studio",
  country: "CA",
  baseCurrency: "CAD",
  timezone: "America/Vancouver",
};

describe("local embeddings", () => {
  it("puts similar questions nearer than unrelated ones", () => {
    const parking = embedText("Parking is behind the building on Fifth Street.");
    const ask = embedText("Where do I park?");
    const weather = embedText("The weather tomorrow looks rainy.");
    const near = (a: number[], b: number[]) => {
      let dot = 0;
      for (let i = 0; i < a.length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
      return dot;
    };
    expect(near(parking, ask)).toBeGreaterThan(near(parking, weather));
  });
});

describe.runIf(hasDatabase)("the retrieval index", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(BUSINESS, OWNER);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("indexes an owner-written note and retrieves it for a matching question", async () => {
    await saveKnowledge.call(
      {
        kind: "policy",
        locale: "en",
        title: "Parking",
        body: "Parking is behind the building on Fifth Street.",
        enabled: true,
      },
      OWNER,
    );
    const notes = await db().transaction((tx) => retrieveNotes(tx, "Where do visitors park?", "en"));
    expect(notes.some((note) => note.body.includes("Fifth Street"))).toBe(true);
  });

  it("leaves a switched-off note out of the index", async () => {
    const entry = await saveKnowledge.call(
      {
        kind: "fact",
        locale: "en",
        title: "Secret",
        body: "The spare key is under the red flowerpot.",
        enabled: false,
      },
      OWNER,
    );
    expect(entry.enabled).toBe(false);
    const notes = await db().transaction((tx) => retrieveNotes(tx, "Where is the spare key?", "en"));
    expect(notes.some((note) => note.body.includes("flowerpot"))).toBe(false);
  });

  it("indexes a published page and not a draft", async () => {
    const live = await createPage.call(
      {
        slug: "hours-page",
        title: "Studio hours",
        blocks: [
          {
            id: "h",
            type: "heading",
            props: { text: "We open the darkroom on Tuesdays only.", level: 1 },
          },
        ],
      },
      OWNER,
    );
    await publishPage.call({ id: live.id, published: true }, OWNER);
    const draft = await createPage.call(
      {
        slug: "draft-secret",
        title: "Unpublished",
        blocks: [
          { id: "h", type: "heading", props: { text: "The combination is 14-32-8.", level: 2 } },
        ],
      },
      OWNER,
    );
    expect(draft.status).toBe("draft");
    await reindex.call({}, OWNER);
    const notes = await db().transaction((tx) => retrieveNotes(tx, "When is the darkroom open?", "en"));
    expect(notes.some((note) => note.body.includes("Tuesdays"))).toBe(true);
    expect(notes.some((note) => note.body.includes("14-32-8"))).toBe(false);
  });

  it("indexes visible location hours", async () => {
    const location = await createLocationService.call(
      {
        name: "Harbour Studio",
        slug: "harbour",
        city: "Courtenay",
        country: "CA",
      },
      OWNER,
    );
    await setOpeningHours.call(
      {
        locationId: location.id,
        entries: [{ weekday: 2, opens: "09:00", closes: "17:00", closed: false }],
      },
      OWNER,
    );
    await reindex.call({}, OWNER);
    const notes = await db().transaction((tx) =>
      retrieveNotes(tx, "What time do you open on Tuesday?", "en"),
    );
    expect(notes.some((note) => /09:00/.test(note.body))).toBe(true);
  });

  it("does not retrieve a French-only note for an English question locale", async () => {
    await saveKnowledge.call(
      {
        kind: "policy",
        locale: "fr",
        title: "Stationnement",
        body: "Le stationnement est derrière le bâtiment.",
        enabled: true,
      },
      OWNER,
    );
    const notes = await db().transaction((tx) => retrieveNotes(tx, "Where is parking?", "en"));
    expect(notes.some((note) => note.body.includes("derrière"))).toBe(false);
  });

  it("lists, updates and deletes knowledge entries", async () => {
    const created = await saveKnowledge.call(
      {
        kind: "qa",
        locale: "en",
        title: "Do you shoot in December?",
        body: "We don't shoot weddings in December.",
        enabled: true,
      },
      OWNER,
    );
    const listed = await knowledgeList.call({}, OWNER);
    expect(listed.some((row) => row.id === created.id)).toBe(true);
    await deleteKnowledge.call({ id: created.id }, OWNER);
    const after = await knowledgeList.call({}, OWNER);
    expect(after.some((row) => row.id === created.id)).toBe(false);
    const notes = await db().transaction((tx) =>
      retrieveNotes(tx, "Do you shoot weddings in December?", "en"),
    );
    expect(notes.some((note) => note.body.includes("December"))).toBe(false);
  });
});
