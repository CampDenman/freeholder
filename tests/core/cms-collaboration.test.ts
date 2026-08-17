// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Presence, merge/reload and comments stay off the live page (C2.03, C2.04).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPage,
  mergePage,
  publishPage,
  resolvePage,
  updatePage,
} from "@/modules/cms/service";
import {
  describeConflict,
  reloadWorkingDraft,
} from "@/modules/cms/lifecycle";
import {
  addComment,
  decideReview,
  expireStalePresence,
  heartbeatPresence,
  leavePresence,
  listComments,
  listPresence,
  reopenThread,
  requestReview,
  resolveThread,
} from "@/modules/cms/collaboration";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  STAFF,
  truncateSpine,
} from "../helpers/spine";

describe.runIf(hasDatabase)("cms collaboration", { timeout: 30_000 }, () => {
  beforeEach(truncateSpine);
  afterAll(closeDb);

  async function draftPage() {
    return createPage.call(
      {
        slug: "studio",
        title: "Studio",
        blocks: [{ id: "h", type: "heading", props: { text: "Studio", level: 1 } }],
      },
      OWNER,
    );
  }

  it("shows who else is on the page and drops a quiet heartbeat", async () => {
    const page = await draftPage();
    await heartbeatPresence.call({ pageId: page.id, editing: true }, OWNER);
    await heartbeatPresence.call({ pageId: page.id, editing: false }, STAFF);
    const together = await listPresence.call({ pageId: page.id }, OWNER);
    expect(together.map((row) => row.actor).sort()).toEqual([
      `user:${OWNER.userId}`,
      `user:${STAFF.userId}`,
    ]);
    expect(together.find((row) => row.actor.endsWith(OWNER.userId))?.editing).toBe(true);

    await leavePresence.call({ pageId: page.id }, STAFF);
    const remaining = await listPresence.call({ pageId: page.id }, OWNER);
    expect(remaining.map((row) => row.actor)).toEqual([`user:${OWNER.userId}`]);

    await heartbeatPresence.call({ pageId: page.id }, OWNER);
    await expireStalePresence.call({}, { kind: "system" });
    expect(await listPresence.call({ pageId: page.id }, OWNER)).toHaveLength(1);
  });

  it("describes a stale save and lets the editor reload or merge explicitly", async () => {
    const created = await draftPage();
    const published = await publishPage.call({ id: created.id, published: true }, OWNER);
    await updatePage.call(
      {
        id: published.id,
        expectedVersion: published.version,
        title: "Studio live edit",
        blocks: [{ id: "h", type: "heading", props: { text: "Live heading", level: 1 } }],
      },
      OWNER,
    );

    const stale = await failure(
      updatePage.call(
        {
          id: published.id,
          expectedVersion: published.version,
          title: "Studio mine",
          blocks: [{ id: "h", type: "heading", props: { text: "My heading", level: 1 } }],
        },
        STAFF,
      ),
    );
    expect(stale.code).toBe("conflict");

    const conflict = await describeConflict.call(
      {
        pageId: published.id,
        expectedVersion: published.version,
        title: "Studio mine",
        blocks: [{ id: "h", type: "heading", props: { text: "My heading", level: 1 } }],
      },
      STAFF,
    );
    expect(conflict.stale).toBe(true);
    expect(conflict.server.title).toBe("Studio live edit");
    expect(conflict.incoming.title).toBe("Studio mine");
    expect(conflict.titleChanged).toBe(true);
    expect(conflict.blocks.changed.map((block) => block.id)).toContain("h");

    const reloaded = await reloadWorkingDraft.call({ pageId: published.id }, STAFF);
    expect(reloaded.title).toBe("Studio live edit");
    expect(reloaded.version).toBe(conflict.server.version);

    const merged = await mergePage.call(
      {
        id: published.id,
        expectedVersion: reloaded.version,
        title: "Studio mine",
        blocks: [{ id: "h", type: "heading", props: { text: "My heading", level: 1 } }],
      },
      STAFF,
    );
    expect(merged.workingTitle).toBe("Studio mine");
    expect(merged.title).toBe("Studio");
    const live = await resolvePage.call({ slug: "studio" }, { kind: "anonymous" });
    expect(live?.title).toBe("Studio");
    expect((live?.blocks as { props: { text: string } }[])[0]?.props.text).toBe("Studio");
  });

  it("keeps comments, mentions and review threads off the published page", async () => {
    const created = await draftPage();
    const published = await publishPage.call({ id: created.id, published: true }, OWNER);
    const note = await addComment.call(
      {
        pageId: published.id,
        blockId: "h",
        body: `Tighten this heading @user:${STAFF.userId}`,
        mentions: [`user:${STAFF.userId}`],
      },
      OWNER,
    );
    expect(note.mentions).toContain(`user:${STAFF.userId}`);
    expect(note.blockId).toBe("h");

    const reply = await addComment.call(
      { pageId: published.id, parentId: note.id, body: "On it." },
      STAFF,
    );
    expect(reply.parentId).toBe(note.id);

    const review = await requestReview.call(
      {
        pageId: published.id,
        reviewer: `user:${STAFF.userId}`,
        body: "Please check the heading.",
        blockId: "h",
      },
      OWNER,
    );
    expect(review.kind).toBe("review_request");
    expect(review.reviewState).toBe("requested");
    expect(review.mentions).toContain(`user:${STAFF.userId}`);

    await decideReview.call(
      { id: review.id, approved: false, note: "Needs a shorter title." },
      STAFF,
    );
    const open = await listComments.call({ pageId: published.id }, OWNER);
    expect(open.some((row) => row.body === "Tighten this heading @user:" + STAFF.userId)).toBe(
      true,
    );
    expect(open.some((row) => row.body === "Needs a shorter title.")).toBe(true);

    await resolveThread.call({ id: note.id }, OWNER);
    const afterResolve = await listComments.call({ pageId: published.id }, OWNER);
    expect(afterResolve.some((row) => row.id === note.id)).toBe(false);
    const withResolved = await listComments.call(
      { pageId: published.id, includeResolved: true },
      OWNER,
    );
    expect(withResolved.some((row) => row.id === note.id && row.resolvedAt)).toBe(true);

    const reopened = await reopenThread.call({ id: note.id }, OWNER);
    expect(reopened.resolvedAt).toBeNull();

    const live = await resolvePage.call({ slug: "studio" }, { kind: "anonymous" });
    expect(live?.title).toBe("Studio");
    const liveText = JSON.stringify(live?.blocks);
    expect(liveText).not.toContain("Tighten this heading");
    expect(liveText).not.toContain("Needs a shorter title");
  });
});
