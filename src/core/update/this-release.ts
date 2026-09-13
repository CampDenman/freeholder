// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Declared metadata for this build (C10.02). Channel and schema risk are
// written here; they are not derived from package.json.
import { PLATFORM_VERSION } from "@/core/platform";
import { parseReleaseMetadata, type ReleaseMetadata } from "./release";

export const THIS_RELEASE: ReleaseMetadata = parseReleaseMetadata({
  version: PLATFORM_VERSION,
  channel: "edge",
  minFromVersion: "0.1.0",
  schemaRisk: "breaking",
  cvss: null,
  severity: "none",
  manualSteps: [],
  pluginApi: PLATFORM_VERSION,
});
