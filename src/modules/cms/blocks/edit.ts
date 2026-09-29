// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Pure editor operations (MASTER.md C2.06).
//
// Kept out of the React tree so undo, duplicate, clipboard and slash filter
// can be tested without a canvas. The component holds state; this decides
// what the next tree is.
import type { BlockNode } from "./types";

export const CLIPBOARD_KIND = "freeholder/blocks";

export interface BlockClipboard {
  kind: typeof CLIPBOARD_KIND;
  nodes: BlockNode[];
}

export function filterPalette<T extends { type: string; label: string }>(
  entries: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase().replace(/^\//, "");
  if (!needle) return entries;
  return entries.filter(
    (entry) =>
      entry.type.toLowerCase().includes(needle) ||
      entry.label.toLowerCase().includes(needle),
  );
}

function cloneNode(node: BlockNode, suffix: string): BlockNode {
  return {
    ...node,
    id: `${node.id}-${suffix}`,
    props: structuredClone(node.props),
    children: node.children?.map((child) => cloneNode(child, suffix)),
  };
}

export function duplicateNodes(nodes: BlockNode[], ids: ReadonlySet<string>): BlockNode[] {
  const result: BlockNode[] = [];
  const stamp = Math.random().toString(36).slice(2, 7);
  for (const node of nodes) {
    const children = node.children ? duplicateNodes(node.children, ids) : undefined;
    const copy = children ? { ...node, children } : node;
    result.push(copy);
    if (ids.has(node.id)) result.push(cloneNode(copy, stamp));
  }
  return result;
}

export function removeNodes(nodes: BlockNode[], ids: ReadonlySet<string>): BlockNode[] {
  const result: BlockNode[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) continue;
    result.push(
      node.children ? { ...node, children: removeNodes(node.children, ids) } : node,
    );
  }
  return result;
}

export function moveSiblings(
  nodes: BlockNode[],
  ids: ReadonlySet<string>,
  direction: -1 | 1,
): BlockNode[] {
  const selected = nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => ids.has(node.id));
  if (selected.length === 0) {
    return nodes.map((node) =>
      node.children
        ? { ...node, children: moveSiblings(node.children, ids, direction) }
        : node,
    );
  }
  const next = [...nodes];
  const ordered = direction === 1 ? [...selected].reverse() : selected;
  for (const { index } of ordered) {
    const target = index + direction;
    if (target < 0 || target >= next.length) continue;
    if (ids.has(next[target]!.id)) continue;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
  }
  return next;
}

export function insertAfter(
  nodes: BlockNode[],
  afterId: string | undefined,
  incoming: BlockNode[],
): BlockNode[] {
  if (!afterId) return [...nodes, ...incoming];
  const result: BlockNode[] = [];
  let placed = false;
  for (const node of nodes) {
    const withChildren = node.children
      ? { ...node, children: insertAfter(node.children, afterId, incoming) }
      : node;
    result.push(withChildren);
    if (node.id === afterId) {
      result.push(...incoming);
      placed = true;
    }
  }
  return placed || result.some((node, i) => node !== nodes[i]) ? result : [...nodes, ...incoming];
}

export function readClipboard(raw: string): BlockNode[] | undefined {
  try {
    const parsed = JSON.parse(raw) as BlockClipboard;
    if (parsed.kind !== CLIPBOARD_KIND || !Array.isArray(parsed.nodes)) return undefined;
    return parsed.nodes;
  } catch {
    return undefined;
  }
}

export function writeClipboard(nodes: BlockNode[]): string {
  return JSON.stringify({ kind: CLIPBOARD_KIND, nodes } satisfies BlockClipboard);
}

export function collectById(nodes: BlockNode[], ids: ReadonlySet<string>): BlockNode[] {
  const found: BlockNode[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) found.push(node);
    if (node.children) found.push(...collectById(node.children, ids));
  }
  return found;
}

/**
 * Set a prop by dotted path, for canvas edits that name a nested value.
 *
 * `"text"` is the common flat case. The canvas can also name a value inside an
 * array prop — an FAQ item's question is `"items.0.question"` — using the same
 * dotted syntax the canvas bridge reads values back with, so the two never
 * drift. Missing intermediate containers are created; arrays are copied at the
 * changed index, matching the immutable updates everywhere else here.
 */
export function setPropAtPath(
  props: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split(".");
  const walk = (container: unknown, depth: number): unknown => {
    const key = keys[depth]!;
    if (Array.isArray(container)) {
      const index = Number(key);
      const copy = container.slice();
      copy[index] = walk(copy[index], depth + 1);
      return copy;
    }
    if (container === undefined || container === null) {
      // Recreate a missing container in the shape this level's key implies:
      // a numeric key indexes into an array, anything else names a record.
      return walk(/^\d+$/.test(key) ? [] : {}, depth);
    }
    const record = container as Record<string, unknown>;
    if (depth === keys.length - 1) return { ...record, [key]: value };
    return { ...record, [key]: walk(record[key], depth + 1) };
  };
  return walk(props, 0) as Record<string, unknown>;
}

/**
 * One recorded edit: what the tree looked like before and after, and the
 * human label the editor chrome shows in the history menu (audit gap 6 —
 * undo/redo the owner can *see*). Both trees are stored so a redo never has
 * to re-derive the state it returns.
 */
export interface HistoryRecord {
  label: string;
  at: number;
  before: BlockNode[];
  after: BlockNode[];
}

/** What the history menu lists: labels only, no trees. */
export interface HistoryEntry {
  label: string;
  at: number;
}

/**
 * The undo stack (MASTER.md C2.06).
 *
 * `past` holds records oldest-first; `future` holds undone records with the
 * most recently undone last (so the tip of `future` is the next redo).
 * `push` is coalescing-aware: a caller passes an `editKey` (a block id plus
 * the prop being typed) and continuous typing into the same field stays one
 * record instead of one per keystroke.
 */
export class EditorHistory {
  private past: HistoryRecord[] = [];
  private future: HistoryRecord[] = [];
  private lastEditKey: string | null = null;

  constructor(private readonly limit = 50) {}

  push(current: BlockNode[], label: string, next?: BlockNode[], editKey?: string): void {
    if (editKey && editKey === this.lastEditKey && next !== undefined && this.past.length > 0) {
      // The same field is still being typed: the open record absorbs the
      // edit. Only `before` is ever read back from a past record (undo
      // returns it, and it was cloned at push time); `after` is overwritten
      // with a fresh snapshot the moment the record moves to the redo stack,
      // so updating it here would be a full-tree clone per keystroke spent
      // on a value nobody reads.
      return;
    }
    this.past.push({
      label,
      at: Date.now(),
      before: structuredClone(current),
      // By reference on purpose: trees are immutable in the editor, and a
      // past record's `after` is never read (undo overwrites it on the way
      // to the redo stack). Cloning per push would tax every edit for
      // nothing — the §15.1 keystroke clock proved it.
      after: next ?? current,
    });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.lastEditKey = editKey ?? null;
  }

  /** Any mutation other than typing breaks a coalescing run. */
  breakRun(): void {
    this.lastEditKey = null;
  }

  undo(current: BlockNode[]): BlockNode[] | undefined {
    const record = this.past.pop();
    if (!record) return undefined;
    this.future.push({ ...record, after: structuredClone(current) });
    this.lastEditKey = null;
    return record.before;
  }

  redo(current: BlockNode[]): BlockNode[] | undefined {
    const record = this.future.pop();
    if (!record) return undefined;
    this.past.push({ ...record, before: structuredClone(current) });
    this.lastEditKey = null;
    return record.after;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * The entries for the visible history menu: undoable oldest-first, then
   * the redoable with the next redo first — one list, oldest → newest →
   * current → next-redo → … .
   */
  entries(): { undoable: HistoryEntry[]; redoable: HistoryEntry[] } {
    const pick = ({ label, at }: HistoryRecord): HistoryEntry => ({ label, at });
    return {
      undoable: this.past.map(pick),
      redoable: [...this.future].reverse().map(pick),
    };
  }

  /**
   * Restore the state *before* `past[index]`'s action, undoing that record
   * and everything newer. The menu lists records oldest-first above the
   * current marker, so clicking a row travels back to just before it.
   */
  restoreUndo(index: number, current: BlockNode[]): BlockNode[] | undefined {
    if (index < 0 || index >= this.past.length) return undefined;
    let tree = current;
    while (this.past.length > index) {
      const previous = this.undo(tree);
      if (!previous) return undefined;
      tree = previous;
    }
    return tree;
  }

  /** Restore the state `index + 1` redos from now (index 0 = one redo). */
  restoreRedo(index: number, current: BlockNode[]): BlockNode[] | undefined {
    let tree: BlockNode[] | undefined;
    for (let step = 0; step <= index; step++) {
      tree = this.redo(tree ?? current);
      if (!tree) return undefined;
    }
    return tree;
  }
}
