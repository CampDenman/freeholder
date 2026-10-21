// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// MRC viewability, as numbers a timer can use (MASTER.md §4.16, C9.19).
//
// §4.16: "an impression counts on render; a *viewable* impression counts at
// 50% of pixels for one continuous second (two for video), observed with an
// IntersectionObserver". The observer lives in the browser; these constants
// are what it is observing *for*, so a test can name the rule without
// starting Chromium.
//
// Video creatives are not built (C9.18 recorded the gap). The two-second
// constant is here so the rule has somewhere to live rather than being
// rediscovered when video arrives.

/** MRC: 50% of the creative's pixels in view. */
export const VIEWABLE_PIXEL_RATIO = 0.5;

/** MRC: one continuous second for display ads. */
export const VIEWABLE_MS = 1_000;

/** MRC: two continuous seconds for video. Unused until a video creative exists. */
export const VIDEO_VIEWABLE_MS = 2_000;

/**
 * Whether a stretch of intersection counts as viewable.
 *
 * `ratio` is IntersectionObserver's intersectionRatio. `heldMs` is how long
 * it has been at or above the threshold without dropping below it. Reset the
 * hold when it drops — "continuous" is the word MRC uses, and a flicker that
 * adds up to a second is not a viewable impression.
 */
export function isViewable(
  ratio: number,
  heldMs: number,
  options: { video?: boolean } = {},
): boolean {
  const need = options.video ? VIDEO_VIEWABLE_MS : VIEWABLE_MS;
  return ratio >= VIEWABLE_PIXEL_RATIO && heldMs >= need;
}
