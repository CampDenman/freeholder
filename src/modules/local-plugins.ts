// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Private plugins installed into *this* instance (MASTER.md §24, §26).
//
// Empty in the repository, and it has to stay that way. A private plugin lives
// in a gitignored directory, so a committed import of one is a build that
// fails for everybody who clones — and the failure arrives at the next person
// rather than at whoever installed it.
//
// An installer overwrites this file locally with the manifests that instance
// actually has; `scripts/install-into-freeholder.mjs` in the WeVibe checkout is
// one. Restore the empty array before committing.
import type { ModuleManifest } from "@/core/module";

export const localPluginManifests: ModuleManifest[] = [];
