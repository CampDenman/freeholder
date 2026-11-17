// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { stopJobs } from "@/core/jobs";
import { resetEnvForTests } from "@/core/env";
import { resetStorageForTests } from "@/adapters/storage";
import { beginUpload } from "@/core/media/service";
import { mediaMultipartOperations, mediaMultipartResources } from "@/core/media/multipart-schema";
import { multipartBirthProvider } from "../helpers/media-multipart-birth-provider";
import { closeDb, OWNER } from "../helpers/spine";

describe("genuine current multipart debt for the browser recovery fixture", () => {
  let provider: Awaited<ReturnType<typeof multipartBirthProvider>>;
  afterAll(async () => { await provider?.close(); vi.unstubAllEnvs(); resetEnvForTests(); resetStorageForTests(); await closeDb(); });
  it("retains an actual unknown CREATE after the provider reply is lost", async () => {
    await ready(); await stopJobs();
    provider = await multipartBirthProvider(); provider.loseNextCreateResponse();
    for (const [name, value] of Object.entries({ NODE_ENV: "test", FREEHOLDER_STORAGE: "s3", S3_ENDPOINT: provider.endpoint, S3_REGION: "fixture", S3_BUCKET: "source", S3_ACCESS_KEY_ID: "synthetic", S3_SECRET_ACCESS_KEY: "synthetic", S3_PUBLIC: "false", FREEHOLDER_STORAGE_QUOTA_BYTES: "", FREEHOLDER_STORAGE_QUOTA_INITIALIZE_EMPTY: "false" })) vi.stubEnv(name, value);
    resetEnvForTests(); resetStorageForTests();
    await expect(beginUpload.call({ filename: "browser-original.png", contentType: "image/png", bytes: 3 }, OWNER)).rejects.toThrow();
    const resources = await db().select().from(mediaMultipartResources);
    const resource = resources.length === 1 ? resources[0] : undefined;
    if (!resource?.originalReservationId || resource.state !== "unknown") throw new Error("The genuine unknown original multipart resource is missing.");
    const [operation] = await db().select().from(mediaMultipartOperations).where(eq(mediaMultipartOperations.resourceId, resource.id));
    if (!operation || operation.state !== "unknown") throw new Error("The genuine unknown original CREATE operation is missing.");
    writeFileSync(process.env.FREEHOLDER_MEDIA_BROWSER_MULTIPART_OUTPUT!, `${JSON.stringify({ resourceId: resource.id, operationId: operation.id, originalEndpoint: provider.endpoint }, null, 2)}\n`, { mode: 0o600 });
  });
});
