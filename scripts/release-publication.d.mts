// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { ReleaseMetadata } from "../src/core/update/release";
export function assertStableCompletion(master: string): void;
export function publicationPlan(input: {
  event: string; ref?: string; sha: string; image: string; declaration: unknown; master?: string;
}): { release: ReleaseMetadata; tags: string[]; prerelease: boolean; stable: boolean; npmTag: string };
