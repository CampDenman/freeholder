// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Declared metadata for this build (C10.02). Channel and schema risk are
// written here; they are not derived from package.json.
import { PLATFORM_VERSION } from "@/core/platform";
import { parseReleaseMetadata, type ReleaseMetadata } from "./release";
import declaration from "./release-declaration.json";

export const THIS_RELEASE: ReleaseMetadata = parseReleaseMetadata(declaration);
if (THIS_RELEASE.version !== PLATFORM_VERSION) {
  throw new Error("Release declaration must match the platform version.");
}
