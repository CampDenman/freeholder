// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Preview links, schedule, approval, named revisions and restore-as-draft (C2.02).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPage,
  publishPage,
  resolvePage,
  restoreRevision,
  updatePage,
} from "@/modules/cms/service";
import {
  applyDueSchedules,
  compareRevisions,
  createPreviewLink,
  decideApproval,
  nameRevision,
  requestApproval,
  resolvePreviewLink,
  revokePreviewLink,
  schedulePage,
  snapshotRevision,
  touchEditLease,
} from "@/modules/cms/lifecycle";
import {
  ANONYMOUS,
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("cms content lifecycle", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function publishedPage() {
    const created = await createPage.call(
      {
        slug: "studio",
        title: "Studio",
        blocks: [{ id: "h", type: "heading", props: { text: "Studio", level: 1 } }],
      },
      OWNER,
    );
    const live = await publishPage.call({ id: created.id, published: true }, OWNER);
    return live;
  }

  it("lets a preview token read the working draft and nothing after revoke", async () => {
    const page = await publishedPage();
    await updatePage.call(
      {
        id: page.id,
        title: "Studio draft",
        blocks: [{ id: "h", type: "heading", props: { text: "Draft heading", level: 1 } }],
      },
      OWNER,
    );
    const minted = await createPreviewLink.call({ pageId: page.id, expiresInHours: 2 }, OWNER);
    const preview = await resolvePreviewLink.call({ token: minted.token }, ANONYMOUS);
    expect(preview?.title).toBe("Studio draft");
    expect((preview?.blocks as { props: { text: string } }[])[0]?.props.text).toBe(
      "Draft heading",
    );
    expect(await resolvePage.call({ slug: "studio" }, ANONYMOUS)).toMatchObject({
      title: "Studio",
    });

    await revokePreviewLink.call({ id: minted.id }, OWNER);
    expect(await resolvePreviewLink.call({ token: minted.token }, ANONYMOUS)).toBeNull();
  });

  it("publishes and unpublishes when the scheduled time has arrived", async () => {
    const created = await createPage.call(
      {
        slug: "soon",
        title: "Soon",
        blocks: [{ id: "h", type: "heading", props: { text: "Soon", level: 1 } }],
      },
      OWNER,
    );
    await schedulePage.call(
      { id: created.id, publishAt: new Date(Date.now() - 1_000) },
      OWNER,
    );
    const applied = await applyDueSchedules.call({}, OWNER);
    expect(applied.published).toContain(created.id);
    expect(await resolvePage.call({ slug: "soon" }, ANONYMOUS)).toMatchObject({
      title: "Soon",
    });

    await schedulePage.call(
      { id: created.id, unpublishAt: new Date(Date.now() - 1_000) },
      OWNER,
    );
    const takenDown = await applyDueSchedules.call({}, OWNER);
    expect(takenDown.unpublished).toContain(created.id);
    expect(await resolvePage.call({ slug: "soon" }, ANONYMOUS)).toBeNull();
  });

  it("refuses to publish a page still waiting for approval", async () => {
    const created = await createPage.call({ slug: "review", title: "Review", blocks: [] }, OWNER);
    await requestApproval.call({ id: created.id, note: "Please look" }, OWNER);
    const blocked = await failure(publishPage.call({ id: created.id, published: true }, OWNER));
    expect(blocked.code).toBe("conflict");

    await decideApproval.call({ id: created.id, approved: true }, STAFF);
    const live = await publishPage.call({ id: created.id, published: true }, OWNER);
    expect(live.status).toBe("published");
    expect(live.approvalState).toBe("none");
  });

  it("restores a named revision onto the working draft of a published page", async () => {
    const page = await publishedPage();
    await updatePage.call(
      {
        id: page.id,
        title: "Studio v2",
        blocks: [{ id: "h", type: "heading", props: { text: "V2", level: 1 } }],
      },
      OWNER,
    );
    const named = await snapshotRevision.call({ pageId: page.id, name: "Before rewrite" }, OWNER);
    await updatePage.call(
      {
        id: page.id,
        title: "Studio v3",
        blocks: [{ id: "h", type: "heading", props: { text: "V3", level: 1 } }],
      },
      OWNER,
    );
    await restoreRevision.call({ revisionId: named.id }, OWNER);
    const current = await resolvePage.call({ slug: "studio" }, ANONYMOUS);
    expect(current?.title).toBe("Studio");

    const { getPage } = await import("@/modules/cms/service");
    const draft = await getPage.call({ id: page.id }, OWNER);
    expect(draft.workingTitle).toBe("Studio v2");
    expect((draft.workingBlocks as { props: { text: string } }[])[0]?.props.text).toBe("V2");
  });

  it("diffs a named snapshot against the current working draft", async () => {
    const page = await publishedPage();
    const named = await snapshotRevision.call({ pageId: page.id, name: "Live snapshot" }, OWNER);
    await updatePage.call(
      {
        id: page.id,
        title: "Studio rewritten",
        blocks: [
          { id: "h", type: "heading", props: { text: "Rewritten", level: 1 } },
          { id: "p", type: "text", props: { body: "More" } },
        ],
      },
      OWNER,
    );
    await nameRevision.call({ revisionId: named.id, name: "Go-live" }, OWNER);
    const diff = await compareRevisions.call(
      { pageId: page.id, fromRevisionId: named.id },
      OWNER,
    );
    expect(diff.titleChanged).toBe(true);
    expect(diff.blocks.added.map((block) => block.id)).toContain("p");
    expect(diff.blocks.changed.map((block) => block.id)).toContain("h");
  });

  it("hands an edit lease to the first editor and reports the holder to the second", async () => {
    const page = await publishedPage();
    const mine = await touchEditLease.call({ id: page.id }, OWNER);
    expect(mine.mine).toBe(true);
    const theirs = await touchEditLease.call({ id: page.id }, STAFF);
    expect(theirs.held).toBe(true);
    expect(theirs.by).toContain(OWNER.userId);
  });
});
