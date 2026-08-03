// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Every module installed in this instance (MASTER.md §11).
//
// A hand-written list rather than a directory scan, for the same reason
// `contacts.merge` keeps a hand-written FK list: a scan would silently pick up
// whatever happens to be on disk, and "what is installed" is a decision, not an
// observation. Adding a module is one line here.
//
// Order is irrelevant — `sortModules` topologically sorts by `requires` at boot
// and fails in plain English on a missing or circular dependency, so listing
// cms before core would be corrected rather than broken.
//
// Toggling a module *off* is a different question from installing it: that is a
// `module_settings` row (§4.8), read at boot once there is a module anyone
// would want off. Core refuses to be disabled at all.
import coreManifest from "@/core/manifest";
import cmsManifest from "@/modules/cms/manifest";
import seedManifest from "@/modules/seed/manifest";
import type { ModuleManifest } from "@/core/module";

const manifests: ModuleManifest[] = [coreManifest, cmsManifest, seedManifest];

export default manifests;
