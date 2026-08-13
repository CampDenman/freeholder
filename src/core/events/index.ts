// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
export interface EventDeliveryContext {
  /** Durable outbox id. Undefined for an in-memory publish. */
  eventId?: string;
  /** Stable manifest-derived identity used by delivery receipts. */
  listenerId: string;
  /** One-based durable delivery attempt. Zero for an in-memory publish. */
  attempt: number;
  /** True after an owner explicitly replays a dead-letter event. */
  replay: boolean;
}

export type BusHandler = (
  payload: unknown,
  eventName: string,
  context?: EventDeliveryContext,
) => void | Promise<void>;

export interface BusListener {
  id: string;
  handler: BusHandler;
}

const listeners = new Map<string, BusListener[]>();

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

/** Modules subscribe at boot with a stable manifest-derived identity (§11). */
export function subscribe(
  eventName: string,
  listenerId: string,
  handler: BusHandler,
): void {
  if (listenerId.trim().length === 0) {
    throw new Error("event listener id cannot be blank");
  }
  const existing = listeners.get(eventName) ?? [];
  const collision = existing.find((listener) => listener.id === listenerId);
  if (collision) {
    if (collision.handler === handler) return;
    throw new Error(
      `event listener "${listenerId}" is registered twice for "${eventName}"`,
    );
  }
  existing.push({ id: listenerId, handler });
  listeners.set(eventName, existing);
}

/** Resolve named plus wildcard listeners once, deduplicated by stable id. */
export function eventListeners(eventName: string): readonly BusListener[] {
  const combined = [
    ...(listeners.get(eventName) ?? []),
    ...(listeners.get(ALL_EVENTS) ?? []),
  ];
  return [...new Map(combined.map((listener) => [listener.id, listener])).values()];
}

/** Run one listener without swallowing its error; the outbox owns persistence. */
export async function runEventListener(
  listener: BusListener,
  eventName: string,
  payload: unknown,
  context: EventDeliveryContext,
): Promise<void> {
  await listener.handler(payload, eventName, context);
}

/** Fan out a committed event. Listener failures are isolated, not fatal. */
export async function publish(
  eventName: string,
  payload: unknown,
): Promise<void> {
  for (const listener of eventListeners(eventName)) {
    try {
      await listener.handler(payload, eventName, {
        listenerId: listener.id,
        attempt: 0,
        replay: false,
      });
    } catch (error) {
      console.error(
        `event listener "${listener.id}" failed for "${eventName}"`,
        error,
      );
    }
  }
}

export function resetBusForTests(): void {
  listeners.clear();
}
