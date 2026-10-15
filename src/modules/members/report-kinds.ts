// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What can be reported and why (C12.12). Outside the schema so app code can
// import it.
export const REPORT_TARGETS = ["post", "comment", "message", "listing", "review", "member"] as const;
export const REPORT_REASONS = ["spam", "harassment", "hate", "violence", "sexual", "child_safety", "scam", "prohibited_item", "impersonation", "self_harm", "other"] as const;
