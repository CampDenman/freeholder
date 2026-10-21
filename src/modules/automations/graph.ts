// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What an automation is, and what makes one invalid
// (MASTER.md §4.17, C9.01).
//
// Pure. No database, no services — the same separation `attribution.ts` and
// `commission.ts` make, and for the same reason: "why was this refused" has to
// be answerable without an instance.
//
// §4.17's load-bearing rule lives here rather than in the runtime:
//
//   "Every loop is bounded at validation, not at runtime. A graph that can
//   express an unbounded loop is refused when it is saved. An automation that
//   runs away is not an incident an owner should be expected to notice — the
//   cheapest place to stop it is before it is switched on."
//
// So `validateGraph` is not a convenience for the editor. It is the guarantee,
// and the publish path refuses a version it rejects.
import { z } from "zod";

/** A node id an owner never sees; stable across edits so runs stay readable. */
const nodeId = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Node ids are lowercase words, numbers, - and _.");

/**
 * The step kinds §4.17 names.
 *
 * `prompt` and `playbook` are both here because an owner wants both: an inline
 * prompt is written in the automation and versioned with it, and a playbook
 * step invokes work that already exists elsewhere. Offering only the first
 * orphans every playbook already written; offering only the second makes
 * "draft this one line" a whole second object to maintain.
 */
export const NODE_KINDS = [
  "call",
  "prompt",
  "playbook",
  "wait",
  "branch",
  "loop",
  "gate",
  "stop",
] as const;

const baseNode = z.object({
  id: nodeId,
  /** What the owner named this step on the canvas. Optional; the id is truth. */
  label: z.string().trim().max(120).optional(),
  /** The node that runs after this one. Null ends the branch. */
  next: nodeId.nullable().default(null),
});

const callNode = baseNode.extend({
  kind: z.literal("call"),
  verb: z.string().trim().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

const promptNode = baseNode.extend({
  kind: z.literal("prompt"),
  /** The brief, versioned with the automation. */
  brief: z.string().trim().min(1).max(8000),
  /** Where the output lands, for later steps to reference. */
  outputKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-zA-Z0-9]*$/, "An output key is a lowercase word.")
    .optional(),
  agentId: z.string().uuid().nullish(),
});

const playbookNode = baseNode.extend({
  kind: z.literal("playbook"),
  playbookId: z.string().uuid(),
  params: z.record(z.string(), z.unknown()).default({}),
  outputKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-zA-Z0-9]*$/)
    .optional(),
});

const waitNode = baseNode.extend({
  kind: z.literal("wait"),
  /**
   * Minutes, capped at a year.
   *
   * A cap rather than an open number because a delay is stored as a wake time
   * and an owner who types 999999 has made a typo, not a plan. §4.17: waiting
   * is a row, so the cost of the cap is nothing and the cost of the typo is a
   * run that never completes and never visibly fails.
   */
  minutes: z.number().int().min(1).max(527_040),
});

/** One side of a branch. Conditions are data, not code — see `condition`. */
const branchArm = z.object({
  /** Left-hand path expression over the run context: "trigger.totalMinor". */
  path: z.string().trim().min(1).max(200),
  op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "exists", "absent"]),
  value: z.unknown().optional(),
  then: nodeId,
});

const branchNode = baseNode.extend({
  kind: z.literal("branch"),
  arms: z.array(branchArm).min(1).max(10),
  /** Where it goes when no arm matches. Null ends the branch. */
  otherwise: nodeId.nullable().default(null),
});

const loopNode = baseNode.extend({
  kind: z.literal("loop"),
  /** The first node of the body. */
  body: nodeId,
  /**
   * Hard, required, and capped. §4.17 refuses a graph that can express an
   * unbounded loop, and "the owner may leave this blank" would be exactly that.
   */
  maxIterations: z.number().int().min(1).max(100),
});

/**
 * An explicit pause for a person.
 *
 * Separate from the autonomy ladder deciding one is needed: a `gate` is the
 * owner saying "always ask me here", which is a stronger statement than the
 * ladder's "ask because this touches money".
 */
const gateNode = baseNode.extend({
  kind: z.literal("gate"),
  reason: z.string().trim().max(300).optional(),
});

const stopNode = baseNode.extend({
  kind: z.literal("stop"),
  reason: z.string().trim().max(300).optional(),
});

export const automationNode = z.discriminatedUnion("kind", [
  callNode,
  promptNode,
  playbookNode,
  waitNode,
  branchNode,
  loopNode,
  gateNode,
  stopNode,
]);

export type AutomationNode = z.infer<typeof automationNode>;

export const automationGraph = z.object({
  /** Where the run begins. */
  entry: nodeId,
  nodes: z.array(automationNode).min(1).max(200),
  /**
   * A ceiling on how many steps one run may take, whatever the graph does.
   *
   * Belt as well as braces: loop caps bound each loop, and this bounds their
   * product. Two nested loops of 100 are each individually reasonable and
   * together are 10,000 steps.
   */
  maxSteps: z.number().int().min(1).max(500).default(100),
});

export type AutomationGraph = z.infer<typeof automationGraph>;

export interface GraphProblem {
  nodeId: string | null;
  message: string;
}

/** Every node this one can hand control to. */
function successors(node: AutomationNode): string[] {
  const out: string[] = [];
  if (node.next) out.push(node.next);
  if (node.kind === "branch") {
    for (const arm of node.arms) out.push(arm.then);
    if (node.otherwise) out.push(node.otherwise);
  }
  if (node.kind === "loop") out.push(node.body);
  return out;
}

/**
 * Everything wrong with this graph, in one pass.
 *
 * All of them, not the first: an owner fixing a canvas one error per save is
 * being made to do the validator's work.
 *
 * `knownVerbs` and `knownEvents` are passed in rather than imported so this
 * file stays pure and a test can state exactly what exists.
 */
export function validateGraph(
  graph: AutomationGraph,
  known: {
    verbs: ReadonlySet<string>;
    /** Verbs that cannot run without a contact, and the trigger's own answer. */
    verbsNeedingContact: ReadonlySet<string>;
    triggerHasContact: boolean;
  },
): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const byId = new Map<string, AutomationNode>();

  for (const node of graph.nodes) {
    if (byId.has(node.id)) {
      problems.push({ nodeId: node.id, message: `Two steps share the id "${node.id}".` });
      continue;
    }
    byId.set(node.id, node);
  }

  if (!byId.has(graph.entry)) {
    problems.push({ nodeId: null, message: `The first step "${graph.entry}" is not in the graph.` });
  }

  for (const node of graph.nodes) {
    for (const target of successors(node)) {
      if (!byId.has(target)) {
        problems.push({
          nodeId: node.id,
          message: `"${node.id}" points at "${target}", which is not a step here.`,
        });
      }
    }

    if (node.kind === "call") {
      if (!known.verbs.has(node.verb)) {
        problems.push({
          nodeId: node.id,
          message: `"${node.verb}" is not something any installed module can do.`,
        });
      } else if (known.verbsNeedingContact.has(node.verb) && !known.triggerHasContact) {
        // Refused at save rather than discovered at run: a schedule-triggered
        // automation has no contact, and "tag the contact" with no contact is
        // a step that would either throw or silently do nothing.
        problems.push({
          nodeId: node.id,
          message: `"${node.verb}" acts on a contact, but this trigger does not have one.`,
        });
      }
    }
  }

  // Unreachable steps. Not fatal to a run, but always a mistake on a canvas:
  // somebody drew a step and never connected it, and silently never running it
  // is how an owner concludes the feature is broken.
  const reached = new Set<string>();
  const queue = byId.has(graph.entry) ? [graph.entry] : [];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    const node = byId.get(id);
    if (!node) continue;
    for (const target of successors(node)) if (!reached.has(target)) queue.push(target);
  }
  for (const node of graph.nodes) {
    if (!reached.has(node.id)) {
      problems.push({ nodeId: node.id, message: `"${node.id}" can never be reached.` });
    }
  }

  problems.push(...unboundedCycles(graph, byId));
  return problems;
}

/**
 * Cycles that no loop bounds.
 *
 * This is the rule §4.17 exists to enforce. A `loop` node declares
 * `maxIterations`, so a cycle whose every path passes through one is bounded
 * and fine. A cycle formed by `next` pointers alone — step A goes to B, B goes
 * back to A — has no bound anywhere and would run until something else stopped
 * it. `maxSteps` would stop it, eventually, but "the run hit its step ceiling"
 * is a report about a mistake nobody was told they had made.
 *
 * Depth-first, tracking the nodes on the current path; a back-edge to a node on
 * the path is a cycle, and it is reported unless a loop sits on that path.
 */
function unboundedCycles(
  graph: AutomationGraph,
  byId: Map<string, AutomationNode>,
): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const seen = new Set<string>();
  const reported = new Set<string>();

  const walk = (id: string, path: string[], loopsOnPath: number): void => {
    const node = byId.get(id);
    if (!node) return;

    const at = path.indexOf(id);
    if (at !== -1) {
      // A cycle. Bounded only if a loop node sits somewhere on it.
      const cycle = path.slice(at);
      const bounded = cycle.some((each) => byId.get(each)?.kind === "loop");
      if (!bounded && !reported.has(id)) {
        reported.add(id);
        problems.push({
          nodeId: id,
          message: `"${id}" is part of a loop with no limit. Put a loop step on it and give it a maximum.`,
        });
      }
      return;
    }

    // Revisiting outside the current path is a diamond, not a cycle — but only
    // skip when no loop is open, or a loop body reached twice by two routes
    // would hide a cycle inside it.
    if (seen.has(id) && loopsOnPath === 0) return;
    seen.add(id);

    const nextPath = [...path, id];
    const opened = loopsOnPath + (node.kind === "loop" ? 1 : 0);
    for (const target of successors(node)) walk(target, nextPath, opened);
  };

  if (byId.has(graph.entry)) walk(graph.entry, [], 0);
  return problems;
}
