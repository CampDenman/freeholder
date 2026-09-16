// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gallery session hygiene (C8.03).
import { defineJob } from "@/core/jobs";

export const expireGallerySessions = defineJob({
  name: "galleries.expireSessions",
  summary: "Delete gallery sessions that have expired.",
  schedule: "11 * * * *",
  concurrency: 1,
  handler: async () => {
    const { expireGallerySessions: expire } = await import("./service");
    return expire.call({}, { kind: "system" });
  },
});


/**
 * Package the galleries a client has asked for (C8.07).
 *
 * A minute apart because the client is waiting and a wedding gallery takes
 * real time to assemble. One at a time: packaging reads every file, and two
 * of them at once is how a small instance runs out of memory.
 */
export const buildGalleryArchives = defineJob({
  name: "galleries.buildArchives",
  summary: "Package galleries that have been asked for.",
  schedule: "* * * * *",
  concurrency: 1,
  handler: async () => {
    const { db } = await import("@/core/db");
    const { eq } = await import("drizzle-orm");
    const { galleryArchives } = await import("./schema");
    const { buildGalleryArchive } = await import("./service");
    const queued = await db()
      .select({ galleryId: galleryArchives.galleryId })
      .from(galleryArchives)
      .where(eq(galleryArchives.state, "building"))
      .limit(5);
    let built = 0;
    for (const row of queued) {
      await buildGalleryArchive.call({ galleryId: row.galleryId }, { kind: "system" });
      built += 1;
    }
    return { built };
  },
});

export default [expireGallerySessions, buildGalleryArchives];
