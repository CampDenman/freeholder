// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const generated = readFileSync(join(root, "../src/generated.ts"), "utf8");

describe("generated SDK catalog", () => {
  it("is present and names the live contact spine", () => {
    assert.match(generated, /export interface ServiceCatalog/);
    assert.match(generated, /"contacts\.create"/);
    assert.match(generated, /export interface FreeholderApi/);
    assert.match(generated, /export const SERVICE_NAMES/);
    assert.match(generated, /export const PAGEABLE_SERVICES/);
  });
});
