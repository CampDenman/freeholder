// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
/** §44.3: who may see a profile field or a published item. */
export const VISIBILITIES = ["public", "followers", "friends", "subscribers", "only_me"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
