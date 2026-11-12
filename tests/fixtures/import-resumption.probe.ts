// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A single phase with no producer/parser memory from the parent test process.
import { writeFile } from "node:fs/promises";
import { it, afterAll } from "vitest";
import { previewFromUpload } from "@/core/import/source-upload";
import { closeDb, OWNER } from "../helpers/spine";

afterAll(closeDb);
it("resumes one original source phase using persisted identifiers only", async () => {
  const id = process.env.FREEHOLDER_IMPORT_PROBE_RUN_ID, uploadId = process.env.FREEHOLDER_IMPORT_PROBE_UPLOAD_ID, output = process.env.FREEHOLDER_IMPORT_PROBE_OUTPUT;
  if (!id || !uploadId || !output) throw new Error("The parent qualification did not supply the owned source identifiers.");
  const result = await previewFromUpload.call({ id, uploadId }, OWNER);
  await writeFile(output, JSON.stringify({ pid: process.pid, result }));
});
