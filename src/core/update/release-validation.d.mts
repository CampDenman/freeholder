// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { ReleaseMetadata, Severity } from "./release";
export function severityForCvss(cvss: number): Severity;
export function validateReleaseMetadata(input: unknown): ReleaseMetadata;
