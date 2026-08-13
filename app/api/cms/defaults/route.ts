// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Create the starting header, footer and home page if they are missing.
//
// A functional endpoint rather than content, so it is a route rather than a
// block (MASTER.md §11): "if an owner could reasonably want to rearrange it,
// it is data; if rearranging it is meaningless, it may be a route."
//
// It exists because seeding normally happens once, on the `settings.
// setupCompleted` event — and an instance that missed that event has no way
// back. This one did: boot was not wired into the request graph, the listener
// never ran, and the site was left with no home page at all. The service is
// idempotent, so this is safe to call at any time and does nothing on a site
// that already has its chrome.
//
// Owner-permission and CSRF-protected by serviceRoute, like every other write.
import { ensureDefaults } from "@/modules/cms/service";
import { serviceRoute } from "@/core/http/route";

export const POST = serviceRoute(ensureDefaults);
