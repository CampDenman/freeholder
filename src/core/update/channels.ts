// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Semantic update channels (MASTER.md §39.2, C10.02). An instance subscribes
// to one of these; the updater never infers the channel from a version number.
export const RELEASE_CHANNELS = ["stable", "security", "edge"] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export interface ChannelDefinition {
  id: ReleaseChannel;
  holds: string;
}

export const CHANNELS: readonly ChannelDefinition[] = [
  {
    id: "stable",
    holds: "Patch and minor releases. The default.",
  },
  {
    id: "security",
    holds: "Security-only patches, backported to the current and previous minor.",
  },
  {
    id: "edge",
    holds: "main. For contributors and freeholder.ai itself.",
  },
];

/**
 * Whether an instance subscribed to `subscribed` will be offered a release
 * published on `offered`. Security is a subset of stable; edge sees everything.
 */
export function channelReceives(
  subscribed: ReleaseChannel,
  offered: ReleaseChannel,
): boolean {
  if (subscribed === "edge") return true;
  if (subscribed === "stable") return offered === "stable" || offered === "security";
  return offered === "security";
}
