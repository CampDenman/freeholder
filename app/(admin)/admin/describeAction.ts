// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Audit rows, said in English (MASTER.md §4.8: "a plain-English log of
// everything their AI did").
//
// Its own module rather than a helper inside the page, because it is the one
// piece of that screen with a right and a wrong answer, and a page file cannot
// export anything a test could reach.
import { listServices } from "@/core/service";

/**
 * A log line for someone who did not build this.
 *
 * Every service already carries a `summary` written for a human — "Merge a
 * duplicate contact into the one that survives." — so the activity feed reads
 * it rather than inventing prose from the service name. Deriving it was always
 * a guess, and it guessed wrong the moment a module's name was not a plural
 * noun: `cms.ensureDefaults` rendered as "Cm — ensure defaults".
 *
 * The fallback stays because an audit row outlives the service that wrote it.
 * A renamed or removed module leaves rows naming something the registry no
 * longer has, and that history still has to read as English. It no longer
 * singularizes anything, since nothing here knows whether the leading word is
 * a plural noun, an acronym or a coined name.
 */
export function describeAction(action: string): string {
  return listServices().get(action)?.def.summary ?? humanizeAction(action);
}

function humanizeAction(action: string): string {
  const [subject, verb] = action.split(".");
  if (!subject || !verb) return action;
  const readable = verb
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} — ${readable}`;
}
