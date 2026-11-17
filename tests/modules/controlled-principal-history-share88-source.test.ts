// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { restoreRowHashLedgerSource } from "../helpers/row-hash-ledger-forward";

const edit = z.object({ before: z.string(), after: z.string() }).strict();
const schema = z.object({ files: z.array(z.object({ path: z.string(), beforeSha256: z.string(), afterSha256: z.string(), edits: z.array(edit) }).strict()) }).passthrough();
const files = ["deploy/controlled-principal-history-share88.source.json", "deploy/controlled-principal-debt-read88.source.json", "deploy/controlled-runtime-dedup88.source.json"]
 .flatMap(path => schema.parse(JSON.parse(readFileSync(path, "utf8"))).files);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("controlled principal-history sharing source continuation", () => {
 it.each(files)("reverses only the exact same-scope sharing edits: $path", row => {
  let source = restoreRowHashLedgerSource(row.path, readFileSync(row.path, "utf8"));
  expect(sha(source)).toBe(row.afterSha256);
  for (const delta of [...row.edits].reverse()) {
   expect(source.split(delta.after)).toHaveLength(2);
   source = source.replace(delta.after, () => delta.before);
  }
  expect(sha(source)).toBe(row.beforeSha256);
 });
});
