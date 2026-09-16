// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Update policy: windows in business timezone, security-auto defaults (C10.08).
import { channelReceives, type ReleaseChannel } from "./channels";
import type { APPLY_LEVELS, POLICY_CHANNELS } from "./schema";

export type PolicyChannel = (typeof POLICY_CHANNELS)[number];
export type ApplyLevel = (typeof APPLY_LEVELS)[number];

export const DEFAULT_UPDATE_WINDOW = {
  days: ["tue", "wed", "thu"] as string[],
  start: "03:00",
};
export const WINDOW_LENGTH_MINUTES = 120;

export interface UpdatePolicy {
  channel: PolicyChannel;
  applyLevel: ApplyLevel;
  window: { days: string[]; start: string };
  drain: boolean;
  notifyChannels: string[];
  keepSnapshots: number;
  lastCheckedAt: Date | null;
  pausedUntil: Date | null;
}

export const DEFAULT_UPDATE_POLICY: UpdatePolicy = {
  channel: "security",
  applyLevel: "security",
  window: { ...DEFAULT_UPDATE_WINDOW, days: [...DEFAULT_UPDATE_WINDOW.days] },
  drain: true,
  notifyChannels: ["email", "sms"],
  keepSnapshots: 5,
  lastCheckedAt: null,
  pausedUntil: null,
};

export function policyReceives(channel: PolicyChannel, offered: ReleaseChannel): boolean {
  if (channel === "off") return false;
  return channelReceives(channel, offered);
}

function parseStartMinutes(start: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(start.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function zonedMinutes(now: Date, timeZone: string): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = (parts.find((part) => part.type === "weekday")?.value ?? "Sun").slice(0, 3).toLowerCase();
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return { weekday, minutes: hour * 60 + minute };
}

/** Skip rather than force: outside the window is a no, not a later retry here. */
export function inUpdateWindow(
  now: Date,
  timeZone: string,
  window: { days: string[]; start: string } = DEFAULT_UPDATE_WINDOW,
): boolean {
  const start = parseStartMinutes(window.start);
  if (start === null || window.days.length === 0) return false;
  const { weekday, minutes } = zonedMinutes(now, timeZone);
  if (!window.days.includes(weekday)) return false;
  const elapsed = (minutes - start + 24 * 60) % (24 * 60);
  return elapsed < WINDOW_LENGTH_MINUTES;
}

export function isPaused(policy: UpdatePolicy, now: Date): boolean {
  return policy.pausedUntil !== null && policy.pausedUntil.getTime() > now.getTime();
}

/**
 * Security-auto default: only security-channel releases apply themselves.
 * Feature (stable/edge) updates are offered and need approval.
 */
export function shouldAutoApply(
  policy: UpdatePolicy,
  release: { channel: ReleaseChannel },
  now: Date,
  timeZone: string,
): boolean {
  if (policy.channel === "off" || isPaused(policy, now)) return false;
  if (!policyReceives(policy.channel, release.channel)) return false;
  if (!inUpdateWindow(now, timeZone, policy.window)) return false;
  if (policy.applyLevel === "none") return false;
  if (policy.applyLevel === "security") return release.channel === "security";
  if (policy.applyLevel === "patch") return release.channel === "security";
  return true;
}

export function requiresApproval(
  policy: UpdatePolicy,
  release: { channel: ReleaseChannel },
): boolean {
  if (policy.channel === "off") return false;
  if (!policyReceives(policy.channel, release.channel)) return false;
  if (policy.applyLevel === "none") return true;
  if (policy.applyLevel === "security" || policy.applyLevel === "patch") {
    return release.channel !== "security";
  }
  return false;
}
