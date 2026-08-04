// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Every table core owns, in one place (MASTER.md §11: a module declares its
// tables in its manifest). Drizzle's migration generator reads the schema
// files directly, so this barrel exists for the things that need the set:
// boot-time introspection, relations, and test truncation.
export { users, sessions } from "@/core/auth/schema";
export { organizations, contacts, timelineEvents } from "@/core/contacts/schema";
export { auditLog } from "@/core/events/schema";
export { assets } from "@/core/media/schema";
export { redirects } from "@/core/seo/schema";
export { rateLimitCounters } from "@/core/security/schema";
export { businessProfile, moduleSettings } from "@/core/settings/schema";
export { entityTranslations } from "@/core/i18n/schema";
export { passwordResets } from "@/core/auth/schema";
export { outboxEvents } from "@/core/events/schema";
