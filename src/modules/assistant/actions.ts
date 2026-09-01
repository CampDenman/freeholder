// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What the assistant may ask to *do* (MASTER.md §31, C9.21).
//
// §31: the assistant "can *act* within tight, owner-granted scopes (start a
// booking, capture a lead, request a quote) via the same permission-scoped
// service layer as everything else."
//
// Two words in that sentence do the work, and this file is where they become
// mechanism rather than intention.
//
// **Tight.** The catalogue below is the ceiling. A model cannot reach a
// service that is not in it, cannot supply an argument the entry does not
// declare, and cannot supply an argument the entry fills in itself. That last
// one matters most: `request_quote` takes the visitor's name and email from
// the chat session, never from the model, so no arrangement of words in a chat
// window can file a quote request in somebody else's name. The model chooses
// *whether*; the module decides *for whom*.
//
// **Owner-granted.** Everything here is off until an owner switches it on, one
// action at a time, in admin. The catalogue is what may be offered; the grants
// are what is offered. An instance that never opens that screen has an
// assistant that can only talk.
//
// The catalogue is short on purpose. Actions that need to know what the
// business sells, when it is free, or what it charges are not safe to offer
// until the assistant is grounded in that data — that is C9.22, and adding
// `check_availability` here before then would be inviting a model to invent an
// appointment. What is here needs no knowledge of the catalogue or the diary:
// one asks a person to take over, and one records that somebody wants a price.
import { z } from "zod";
import { getService, type Service, type ServiceContext } from "@/core/service";

/** Everything the module knows about the visitor, without asking the model. */
export interface AssistantActionContext {
  conversationId: string;
  contactName: string;
  contactEmail: string;
  /** What the visitor just said, for actions that need to carry it forward. */
  question: string;
}

export interface AssistantAction {
  /** Stable key: stored in grants, named in the prompt, shown in admin. */
  id: string;
  /** The service it calls. Resolved by name so an uninstalled module is absent. */
  service: string;
  /** Whether taking it changes anything. Shown in admin beside the switch. */
  writes: boolean;
  /** One line, in the prompt, telling the model when this is the right ask. */
  description: string;
  /** Exactly what the model may fill in. Anything else is refused. */
  arguments: z.ZodType;
  /** The service input, assembled from model arguments *and* known facts. */
  build: (args: never, context: AssistantActionContext) => unknown;
}

function action<A extends z.ZodType>(entry: {
  id: string;
  service: string;
  writes: boolean;
  description: string;
  arguments: A;
  build: (args: z.output<A>, context: AssistantActionContext) => unknown;
}): AssistantAction {
  return entry as unknown as AssistantAction;
}

export const ASSISTANT_ACTIONS: readonly AssistantAction[] = [
  action({
    id: "hand_to_a_person",
    service: "messaging.escalateAssistantChat",
    writes: true,
    description:
      "Ask a person at the business to take over this conversation. Use it whenever you are not sure, or the visitor asks for a human.",
    arguments: z.object({
      reason: z.string().trim().min(1).max(300),
    }),
    build: (args, context) => ({
      conversationId: context.conversationId,
      reason: args.reason,
    }),
  }),
  action({
    id: "request_quote",
    service: "cms.submitQuoteRequest",
    writes: true,
    description:
      "Record that this visitor wants a price. Use it only when they have said what they want quoted.",
    arguments: z.object({
      summary: z.string().trim().min(1).max(2_000),
    }),
    // Name and email come from the chat session's contact. The model is not
    // offered them, so it cannot file this against anybody else.
    build: (args, context) => ({
      name: context.contactName,
      email: context.contactEmail,
      message: args.summary,
    }),
  }),
];

export const ASSISTANT_ACTION_IDS: readonly string[] = ASSISTANT_ACTIONS.map(
  (entry) => entry.id,
);

export function assistantAction(id: string): AssistantAction | undefined {
  return ASSISTANT_ACTIONS.find((entry) => entry.id === id);
}

/**
 * Whether the service an action needs is installed on this instance.
 *
 * An action whose module is switched off is not an error — it is simply not on
 * offer, the same way the admin screen does not advertise it.
 */
export function actionService(entry: AssistantAction): Service | undefined {
  try {
    return getService(entry.service);
  } catch {
    return undefined;
  }
}

export type ActionVerdict =
  | { allowed: true; entry: AssistantAction; input: unknown }
  | { allowed: false; reason: string };

/**
 * The gate. Four ways to be refused, all decided here rather than in a prompt.
 *
 * Returns a verdict instead of throwing, because a refusal has to be recorded
 * and a throw inside the caller's transaction would roll the record back — the
 * refusal would then leave no trace, which is the one thing an owner asking
 * "why did it not do that" cannot work around.
 */
export function verdictFor(
  id: unknown,
  args: unknown,
  granted: ReadonlySet<string>,
  context: AssistantActionContext,
): ActionVerdict {
  if (typeof id !== "string" || !id) {
    return { allowed: false, reason: "The assistant asked for an action with no name." };
  }
  const entry = assistantAction(id);
  if (!entry) {
    return {
      allowed: false,
      reason: `"${id.slice(0, 60)}" is not something this assistant can ever do.`,
    };
  }
  if (!granted.has(entry.id)) {
    return {
      allowed: false,
      reason: `"${entry.id}" is not switched on for this assistant.`,
    };
  }
  const parsed = entry.arguments.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      allowed: false,
      reason: `"${entry.id}" was asked for with details this action does not accept.`,
    };
  }
  return {
    allowed: true,
    entry,
    input: entry.build(parsed.data as never, context),
  };
}

/**
 * Run an allowed action inside the caller's transaction.
 *
 * `callAsSystem` because the visitor is anonymous and the effect is one the
 * platform performs on their behalf — the same elevation an anonymous form
 * submission uses to reach `contacts.resolve`. Both audit rows are still
 * written, so the chain from a chat message to a quote request stays readable.
 */
export async function runAction(
  ctx: ServiceContext,
  entry: AssistantAction,
  input: unknown,
): Promise<void> {
  const service = actionService(entry);
  if (!service) {
    throw new Error(`"${entry.id}" needs ${entry.service}, which is not installed.`);
  }
  await ctx.callAsSystem(service, input);
}
