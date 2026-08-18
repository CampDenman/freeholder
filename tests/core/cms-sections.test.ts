// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Synced Section instances (C2.12).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  collectSectionKeys,
  collectSectionKeysFromUnknown,
  replaceNodes,
  slugifySectionName,
} from "@/modules/cms/section-instances";
import {
  createSection,
  deleteSection,
  detachSection,
  listSectionUsages,
  saveAsSection,
} from "@/modules/cms/section-service";
import { createPage, ensureDefaults, updatePage } from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe("section instance helpers", () => {
  it("collects keys from a nested tree and replaces a selection", () => {
    const tree = [
      {
        id: "keep",
        type: "heading",
        props: { text: "Stay" },
      },
      {
        id: "take",
        type: "sectionInstance",
        props: { sectionKey: "cta" },
      },
    ];
    expect([...collectSectionKeys(tree)]).toEqual(["cta"]);
    expect([...collectSectionKeysFromUnknown(tree)]).toEqual(["cta"]);
    const next = replaceNodes(tree, new Set(["take"]), [
      { id: "copy", type: "text", props: { body: "local" } },
    ]);
    expect(next.map((node) => node.id)).toEqual(["keep", "copy"]);
    expect(slugifySectionName("Call To Action")).toBe("call-to-action");
  });
});

describe.runIf(hasDatabase)("cms section instances", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine, 30_000);
  afterAll(closeDb);

  it("saves selected blocks as a synced instance and detaches a copy", async () => {
    await updateBusiness.call(
      {
        name: "Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        schemaType: "Photographer",
      },
      OWNER,
    );
    const heading = {
      id: "hero",
      type: "heading" as const,
      props: { text: "Welcome", level: 2 },
    };
    const saved = await saveAsSection.call(
      { name: "Hero band", nodes: [heading] },
      OWNER,
    );
    expect(saved.instance.type).toBe("sectionInstance");
    expect(saved.instance.props.sectionKey).toBe(saved.section.key);

    const page = await createPage.call({ title: "Home", slug: "welcome" }, OWNER);
    await updatePage.call(
      { id: page.id, blocks: [saved.instance] },
      OWNER,
    );

    const usages = await listSectionUsages.call({ key: saved.section.key }, OWNER);
    expect(usages.some((row) => row.kind === "page")).toBe(true);

    const blocked = await failure(
      deleteSection.call({ key: saved.section.key }, OWNER),
    );
    expect(blocked.code).toBe("conflict");

    const detached = await detachSection.call(
      { sectionKey: saved.section.key },
      OWNER,
    );
    expect(detached.nodes[0]?.type).toBe("heading");
    expect(detached.nodes[0]?.props.text).toBe("Welcome");
    expect(detached.nodes[0]?.id).not.toBe("hero");

    await updatePage.call({ id: page.id, blocks: detached.nodes }, OWNER);
    const removed = await deleteSection.call({ key: saved.section.key }, OWNER);
    expect(removed.deleted).toBe(1);
  });

  it("refuses a Section that instances itself and refuses deleting chrome", async () => {
    await updateBusiness.call(
      {
        name: "Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
        schemaType: "Photographer",
      },
      OWNER,
    );
    const loop = await failure(
      createSection.call(
        {
          name: "Loop",
          key: "loop",
          blocks: [
            {
              id: "self",
              type: "sectionInstance",
              props: { sectionKey: "loop" },
            },
          ],
        },
        OWNER,
      ),
    );
    expect(loop.code).toBe("validation");

    await ensureDefaults.call({}, OWNER);
    const chrome = await failure(deleteSection.call({ key: "header" }, OWNER));
    expect(chrome.code).toBe("conflict");
  });
});
