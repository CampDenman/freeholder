// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.47: real ZIP graph reads retain the original private storage resource.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "@/core/db";
import { stopJobs } from "@/core/jobs";
import { resetEnvForTests } from "@/core/env";
import { resetStorageForTests, storage } from "@/adapters/storage";
import { importSourceEntries } from "@/core/plugins/schema";
import { startImport } from "@/core/import/service";
import { beginSourceUpload, previewFromUpload, uploadSourceChunk } from "@/core/import/source-upload";
import { originalStaticZip } from "../helpers/original-static-zip";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const originalBytes = originalStaticZip(Array.from({ length: 501 }, (_, index) => ({
  path: `site/page-${index}.html`, body: `<html><title>Original ${index}</title><p>Fictional source ${index}.</p></html>`,
})));

describe.runIf(hasDatabase)("ZIP graph original storage namespace (C3.47)", { timeout: 60_000 }, () => {
  beforeEach(async () => { await truncateSpine(); resetStorageForTests(); });
  afterAll(async () => { vi.restoreAllMocks(); await stopJobs(); await closeDb(); });

  it("refuses a same-key replacement store during actual ZIP continuation and resumes only its original", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "freeholder-zip-source-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "freeholder-zip-source-b-"));
    const select = (root: string) => { vi.stubEnv("FREEHOLDER_STORAGE", "local"); vi.stubEnv("LOCAL_STORAGE_ROOT", root); resetEnvForTests(); resetStorageForTests(); };
    try {
      select(rootA);
      const original = storage(), run = await startImport.call({ origin: "https://fictional-zip-namespace.example", kind: "archive" }, OWNER);
      const upload = await beginSourceUpload.call({ id: run.id, filename: "actual-original.zip", bytes: originalBytes.byteLength }, OWNER);
      expect(upload.chunkCount).toBe(1);
      await uploadSourceChunk.call({ id: run.id, uploadId: upload.uploadId, index: 0, bytes: originalBytes }, OWNER);
      expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).toMatchObject({ status: "discover" });
      const key = `imports/${run.id}/${upload.uploadId}/00000.part`;
      select(rootB);
      const replacement = storage(), replacementGet = replacement.get.bind(replacement);
      // Independent same-key bytes are deliberately installed in the disposable
      // replacement namespace; they supply no authority over the original.
      await replacement.put(key, originalBytes, "application/zip");
      const reads = vi.spyOn(replacement, "get"), deletes = vi.spyOn(replacement, "delete"), puts = vi.spyOn(replacement, "put");
      await expect(previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).rejects.toThrow(/original storage resource/);
      expect(reads).not.toHaveBeenCalled(); expect(deletes).not.toHaveBeenCalled(); expect(puts).not.toHaveBeenCalled();
      expect(await db().select().from(importSourceEntries)).toHaveLength(0);
      expect(await original.get(key)).toEqual(originalBytes);
      expect(await replacementGet(key)).toEqual(originalBytes);
      reads.mockRestore(); deletes.mockRestore(); puts.mockRestore();
      select(rootA);
      expect(await previewFromUpload.call({ id: run.id, uploadId: upload.uploadId }, OWNER)).toMatchObject({ status: "discover", counts: { indexed: 500 } });
      expect(await original.get(key)).toEqual(originalBytes);
      expect(await replacementGet(key)).toEqual(originalBytes);
    } finally {
      vi.restoreAllMocks(); vi.unstubAllEnvs(); resetEnvForTests(); resetStorageForTests();
      await rm(rootA, { recursive: true, force: true }); await rm(rootB, { recursive: true, force: true });
    }
  });
});
