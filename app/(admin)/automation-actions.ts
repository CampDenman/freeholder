// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The admin's automation editor. Thin, like every other caller (§11).
//
// Steps are edited one at a time through form posts rather than by shipping a
// graph editor to the browser. That is the same decision the segment builder
// records: a native form is keyboard- and screen-reader-correct for free and
// works before any JavaScript has loaded, and a drag-and-drop canvas is
// neither. What an owner loses is a picture; what they keep is a screen that
// works on a phone in a van.
//
// Every action here reads the draft, changes one thing, and writes it back.
// The graph is small — §4.17 caps it at 200 nodes — so read-modify-write is
// honest rather than clever, and it keeps the whole edit inside one service
// call that validates the result.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  getAutomation,
  publish,
  restoreVersion,
  saveAutomation,
  setStatus,
} from "@/modules/automations/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value.length > 0 ? value : null;
}

function digits(form: FormData, name: string): number | null {
  const value = text(form, name);
  if (value.length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A step as the form posts it, back into the shape the graph schema wants. */
type Node = Record<string, unknown> & { id: string; kind: string; next: string | null };

interface Draft {
  entry: string;
  maxSteps: number;
  nodes: Node[];
}

function draftOf(graph: unknown): Draft {
  if (typeof graph !== "object" || graph === null) {
    return { entry: "", maxSteps: 100, nodes: [] };
  }
  const bag = graph as Partial<Draft>;
  return {
    entry: typeof bag.entry === "string" ? bag.entry : "",
    maxSteps: typeof bag.maxSteps === "number" ? bag.maxSteps : 100,
    nodes: Array.isArray(bag.nodes) ? bag.nodes : [],
  };
}

/**
 * Send the owner back to the editor, saying what went wrong in their words.
 *
 * A `ServiceError` here is nearly always the validator refusing something —
 * an unbounded loop, a verb that needs a contact — and its message is already
 * written for a person. Anything else is a bug and should not be dressed up as
 * advice.
 */
function back(automationId: string, error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`/admin/automations/${automationId}?error=${encodeURIComponent(error.message)}`);
  }
  // Anything that is not a ServiceError is a bug, and dressing it up as advice
  // to the owner would hide it. Rethrown as-is for the error boundary.
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("automation editor failed");
  redirect(`/admin/automations/${automationId}?saved=1`);
}

async function writeDraft(automationId: string, mutate: (draft: Draft) => void): Promise<never> {
  const caller = await actor();
  try {
    const current = await getAutomation.call({ automationId }, caller);
    const draft = draftOf(current.draftGraph);
    mutate(draft);
    await saveAutomation.call(
      {
        id: automationId,
        name: current.automation.name,
        description: current.automation.description,
        triggerKind: current.automation.triggerKind,
        eventPattern: current.automation.eventPattern,
        scheduleCron: current.automation.scheduleCron,
        timezone: current.automation.timezone,
        entrySegmentId: current.automation.entrySegmentId,
        autonomyCeiling: current.automation.autonomyCeiling,
        budgetMinor: current.automation.budgetMinor,
        reentry: current.automation.reentry,
        cooldownDays: current.automation.cooldownDays,
        draftGraph: draft,
      },
      caller,
    );
  } catch (error) {
    revalidatePath(`/admin/automations/${automationId}`);
    back(automationId, error);
  }
  revalidatePath(`/admin/automations/${automationId}`);
  back(automationId);
}

export async function createAutomationAction(form: FormData): Promise<void> {
  const caller = await actor();
  let created: { id: string };
  try {
    created = await saveAutomation.call(
      {
        name: text(form, "name"),
        description: text(form, "description"),
        triggerKind: (text(form, "triggerKind") || "event") as "event" | "schedule" | "manual",
        eventPattern: optional(form, "eventPattern"),
        scheduleCron: optional(form, "scheduleCron"),
        draftGraph: { entry: "", maxSteps: 100, nodes: [] },
      },
      caller,
    );
  } catch (error) {
    if (error instanceof ServiceError) {
      redirect(`/admin/automations?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
  revalidatePath("/admin/automations");
  redirect(`/admin/automations/${created.id}`);
}

export async function saveSettingsAction(form: FormData): Promise<void> {
  const caller = await actor();
  const automationId = text(form, "automationId");
  try {
    await saveAutomation.call(
      {
        id: automationId,
        name: text(form, "name"),
        description: text(form, "description"),
        triggerKind: (text(form, "triggerKind") || "event") as "event" | "schedule" | "manual",
        eventPattern: optional(form, "eventPattern"),
        scheduleCron: optional(form, "scheduleCron"),
        timezone: optional(form, "timezone"),
        autonomyCeiling: (optional(form, "autonomyCeiling") ?? null) as
          | "suggest"
          | "approve"
          | "autonomous"
          | null,
        budgetMinor: digits(form, "budgetMinor"),
        reentry: (text(form, "reentry") || "once") as "once" | "cooldown" | "always",
        cooldownDays: digits(form, "cooldownDays"),
      },
      caller,
    );
  } catch (error) {
    back(automationId, error);
  }
  revalidatePath(`/admin/automations/${automationId}`);
  back(automationId);
}

/**
 * Add a step, and wire it to the end of the chain.
 *
 * Appending rather than asking where it goes: an owner adding a step almost
 * always means "then this", and a screen that made them choose a predecessor
 * first would be asking about the graph before they had drawn it. They can
 * repoint it afterwards, one select, on the step itself.
 */
export async function addStepAction(form: FormData): Promise<void> {
  const automationId = text(form, "automationId");
  const kind = text(form, "kind");
  await writeDraft(automationId, (draft) => {
    const id = uniqueId(draft, kind);
    const node: Node = { id, kind, next: null };
    if (kind === "call") {
      node.verb = text(form, "verb");
      node.params = {};
    }
    if (kind === "prompt") node.brief = "";
    if (kind === "wait") node.minutes = 60;
    if (kind === "loop") {
      node.body = "";
      node.maxIterations = 5;
    }
    if (kind === "branch") {
      node.arms = [];
      node.otherwise = null;
    }

    const last = draft.nodes.at(-1);
    if (last && last.next === null && last.kind !== "stop") last.next = id;
    draft.nodes.push(node);
    if (!draft.entry) draft.entry = id;
  });
}

function uniqueId(draft: Draft, kind: string): string {
  const taken = new Set(draft.nodes.map((node) => node.id));
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${kind}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${kind}${Date.now()}`;
}

export async function updateStepAction(form: FormData): Promise<void> {
  const automationId = text(form, "automationId");
  const stepId = text(form, "stepId");
  await writeDraft(automationId, (draft) => {
    const node = draft.nodes.find((each) => each.id === stepId);
    if (!node) return;
    node.next = optional(form, "next");
    node.label = optional(form, "label") ?? undefined;
    if (node.kind === "call") {
      node.verb = text(form, "verb");
      // One free-text parameter per verb for now. The verb registry declares
      // no parameter schema yet, so the screen cannot render typed fields
      // honestly — and inventing them would be a form that lies about what
      // the verb accepts.
      const key = text(form, "paramKey");
      const value = text(form, "paramValue");
      node.params = key ? { [key]: value } : {};
    }
    if (node.kind === "prompt") {
      node.brief = text(form, "brief");
      node.outputKey = optional(form, "outputKey") ?? undefined;
    }
    if (node.kind === "wait") node.minutes = digits(form, "minutes") ?? 60;
    if (node.kind === "loop") {
      node.body = text(form, "body");
      node.maxIterations = digits(form, "maxIterations") ?? 5;
    }
    if (node.kind === "gate" || node.kind === "stop") {
      node.reason = optional(form, "reason") ?? undefined;
    }
  });
}

export async function removeStepAction(form: FormData): Promise<void> {
  const automationId = text(form, "automationId");
  const stepId = text(form, "stepId");
  await writeDraft(automationId, (draft) => {
    draft.nodes = draft.nodes.filter((node) => node.id !== stepId);
    // Anything pointing at the removed step now points nowhere, which is
    // honest: the alternative is silently rewiring somebody's graph around a
    // deletion and hoping they meant it.
    for (const node of draft.nodes) {
      if (node.next === stepId) node.next = null;
      if (node.kind === "loop" && node.body === stepId) node.body = "";
    }
    if (draft.entry === stepId) draft.entry = draft.nodes[0]?.id ?? "";
  });
}

export async function setEntryAction(form: FormData): Promise<void> {
  const automationId = text(form, "automationId");
  await writeDraft(automationId, (draft) => {
    draft.entry = text(form, "entry");
  });
}

export async function publishAction(form: FormData): Promise<void> {
  const caller = await actor();
  const automationId = text(form, "automationId");
  try {
    await publish.call(
      {
        automationId,
        note: optional(form, "note"),
        activate: form.get("activate") === "1",
      },
      caller,
    );
  } catch (error) {
    back(automationId, error);
  }
  revalidatePath(`/admin/automations/${automationId}`);
  revalidatePath("/admin/automations");
  back(automationId);
}

export async function setStatusAction(form: FormData): Promise<void> {
  const caller = await actor();
  const automationId = text(form, "automationId");
  try {
    await setStatus.call(
      { automationId, status: text(form, "status") as "active" | "paused" | "archived" },
      caller,
    );
  } catch (error) {
    back(automationId, error);
  }
  revalidatePath(`/admin/automations/${automationId}`);
  revalidatePath("/admin/automations");
  back(automationId);
}

export async function restoreVersionAction(form: FormData): Promise<void> {
  const caller = await actor();
  const automationId = text(form, "automationId");
  try {
    await restoreVersion.call({ versionId: text(form, "versionId") }, caller);
  } catch (error) {
    back(automationId, error);
  }
  revalidatePath(`/admin/automations/${automationId}`);
  back(automationId);
}
