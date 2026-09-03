// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Per-network caption, aspect and duration limits (MASTER.md §33, C9.26).
import type { SocialAspect } from "./contract";

export interface NetworkPolicy {
  captionLimit: number;
  aspect: SocialAspect;
  maxDurationSeconds: number;
  safeArea: { top: number; bottom: number; left: number; right: number };
}

const TALL = { top: 0.12, bottom: 0.18, left: 0.04, right: 0.04 };
const SQUARE = { top: 0.04, bottom: 0.04, left: 0.04, right: 0.04 };
const WIDE = { top: 0.04, bottom: 0.08, left: 0.04, right: 0.04 };

const POLICIES: Record<string, NetworkPolicy> = {
  instagram: { captionLimit: 2_200, aspect: "4:5", maxDurationSeconds: 60, safeArea: TALL },
  facebook: { captionLimit: 5_000, aspect: "1:1", maxDurationSeconds: 240, safeArea: SQUARE },
  tiktok: { captionLimit: 2_200, aspect: "9:16", maxDurationSeconds: 180, safeArea: TALL },
  youtube: { captionLimit: 5_000, aspect: "16:9", maxDurationSeconds: 60, safeArea: WIDE },
  linkedin: { captionLimit: 3_000, aspect: "1:1", maxDurationSeconds: 180, safeArea: SQUARE },
  x: { captionLimit: 280, aspect: "16:9", maxDurationSeconds: 140, safeArea: WIDE },
  pinterest: { captionLimit: 500, aspect: "9:16", maxDurationSeconds: 60, safeArea: TALL },
  google_business: { captionLimit: 1_500, aspect: "1:1", maxDurationSeconds: 30, safeArea: SQUARE },
};

const FALLBACK: NetworkPolicy = {
  captionLimit: 2_000,
  aspect: "1:1",
  maxDurationSeconds: 60,
  safeArea: SQUARE,
};

export function policyFor(provider: string): NetworkPolicy {
  return POLICIES[provider] ?? FALLBACK;
}

export function parseHashtags(caption: string): string[] {
  const found = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(found.map((tag) => tag.slice(1).toLowerCase()))].slice(0, 30);
}

export function clipCaption(caption: string, limit: number): string {
  const trimmed = caption.trim();
  if (trimmed.length <= limit) return trimmed;
  return trimmed.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}
