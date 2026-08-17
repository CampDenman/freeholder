// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Working drafts must not mutate the live published page (C2.01, C2.03).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPage,
  getPage,
  publishPage,
  resolvePage,
  updatePage,
} from "@/modules/cms/service";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("published pages keep a working draft", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  it("lets autosave change the working copy without changing the public page", async () => {
    const created = await createPage.call(
      {
        slug: "about",
        title: "About",
        blocks: [{ id: "h", type: "heading", props: { text: "About us", level: 1 } }],
        seo: { description: "Who we are" },
      },
      OWNER,
    );
    await publishPage.call({ id: created.id, published: true }, OWNER);

    const edited = await updatePage.call(
      {
        id: created.id,
        expectedVersion: created.version + 1,
        title: "About the studio",
        blocks: [{ id: "h", type: "heading", props: { text: "The studio", level: 1 } }],
        seo: { description: "Draft copy" },
      },
      OWNER,
    );
    expect(edited.title).toBe("About");
    expect(edited.workingTitle).toBe("About the studio");
    expect((edited.blocks as { props: { text: string } }[])[0]?.props.text).toBe("About us");
    expect((edited.workingBlocks as { props: { text: string } }[])[0]?.props.text).toBe("The studio");

    const publicPage = await resolvePage.call({ slug: "about" }, ANONYMOUS);
    expect(publicPage?.title).toBe("About");
    expect((publicPage?.blocks as { props: { text: string } }[])[0]?.props.text).toBe("About us");

    const published = await publishPage.call({ id: created.id, published: true }, OWNER);
    expect(published.title).toBe("About the studio");
    const live = await resolvePage.call({ slug: "about" }, ANONYMOUS);
    expect(live?.title).toBe("About the studio");
  });

  it("refuses a stale working-copy write", async () => {
    const created = await createPage.call(
      { slug: "contact", title: "Contact", blocks: [] },
      OWNER,
    );
    const blocked = await failure(
      updatePage.call(
        { id: created.id, expectedVersion: created.version + 5, title: "Nope" },
        OWNER,
      ),
    );
    expect(blocked.code).toBe("conflict");
    const current = await getPage.call({ id: created.id }, OWNER);
    expect(current.title).toBe("Contact");
  });
});
