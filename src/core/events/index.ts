// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// TimelineEvent emitter + module event bus (MASTER.md §4.1, §10, §11).
// Timeline rows are written inside the caller's transaction — an event about
// a mutation that didn't commit must be impossible. Bus events are the
// opposite: they fan out to other modules only *after* commit, so a listener
// never observes state that later rolled back.
import { timelineEvents } from "@/core/contacts/schema";
import type { Tx } from "@/core/service";

export interface TimelineEventInput {
  contactId: string;
  /** Dotted past-tense verb: "contact.created", "quote.sent"… */
  eventType: string;
  subjectType: string;
  subjectId?: string;
  payload?: Record<string, unknown>;
}

export async function writeTimelineEvent(
  tx: Tx,
  actor: string,
  event: TimelineEventInput,
): Promise<void> {
  await tx.insert(timelineEvents).values({
    contactId: event.contactId,
    actor,
    eventType: event.eventType,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    payload: event.payload ?? {},
  });
}

/**
 * The event name is passed alongside the payload so a wildcard listener knows
 * what it just received. Named listeners ignore it, which is why adding it was
 * safe — a handler that takes one argument keeps working unchanged.
 */
type BusHandler = (
  payload: unknown,
  eventName: string,
) => void | Promise<void>;

const listeners = new Map<string, BusHandler[]>();

/**
 * Every event, whatever its name.
 *
 * Added for outbound webhooks, which cannot enumerate what to listen for: a
 * module installed tomorrow emits events nobody has written down here, and an
 * owner who subscribed to `*` expects to receive them. Deliberately narrow —
 * this is a *fan-out* seam, not a way for a module to observe another module's
 * traffic, which §11 routes through named events on purpose.
 */
export const ALL_EVENTS = "*";

/** Modules subscribe at boot via their manifest's `events.listens` (§11). */
export function subscribe(eventName: string, handler: BusHandler): void {
  const existing = listeners.get(eventName) ?? [];
  existing.push(handler);
  listeners.set(eventName, existing);
}

/** Fan out a committed event. Listener failures are isolated, not fatal. */
export async function publish(
  eventName: string,
  payload: unknown,
): Promise<void> {
  const handlers = [
    ...(listeners.get(eventName) ?? []),
    ...(listeners.get(ALL_EVENTS) ?? []),
  ];
  for (const handler of handlers) {
    try {
      await handler(payload, eventName);
    } catch (error) {
      console.error(`event listener failed for "${eventName}"`, error);
    }
  }
}

export function resetBusForTests(): void {
  listeners.clear();
}
