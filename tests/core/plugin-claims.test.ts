// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.13: only one provider operation may own an existing job/room/artifact.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { getService } from "@/core/service";
import { createContact } from "@/core/contacts/service";
import { podJobs } from "../../plugins/print-on-demand/schema";
import { voiceVideoArtifacts, voiceVideoRooms } from "../../plugins/voice-video/schema";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("exclusive plugin claims", { timeout: 30_000 }, () => {
  beforeEach(async () => { await ready(); await truncateSpine(); });
  afterAll(closeDb);

  async function oneClaim(name: string, input: Record<string, unknown>) {
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () =>
      getService(name).call(input, { kind: "system" })));
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of outcomes) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "conflict" });
    }
  }

  it("serializes competing print submissions", async () => {
    const [job] = await db().insert(podJobs).values({ sku: "concurrent", provider: "fixture" }).returning();
    await oneClaim("printOnDemand.claimSubmit", { jobId: job!.id });
  });

  it("serializes room retries, recording stops and artifact retries", async () => {
    const contact = await createContact.call({ name: "Concurrent", email: "concurrent@example.test" }, OWNER);
    const common = { contactId: contact.id, kind: "video", provider: "fixture", title: "Concurrent room" };
    const [room] = await db().insert(voiceVideoRooms).values({ ...common, status: "failed" }).returning();
    await oneClaim("voiceVideo.claimStart", { ...common, roomId: room!.id });
    const [live] = await db().insert(voiceVideoRooms).values({ ...common, status: "live", externalRef: "existing-room" }).returning();
    await oneClaim("voiceVideo.claimStop", { roomId: live!.id });
    const [artifact] = await db().insert(voiceVideoArtifacts).values({ ...common, status: "failed" }).returning();
    await oneClaim("voiceVideo.claimCapture", { ...common, artifactId: artifact!.id });
  });
});
