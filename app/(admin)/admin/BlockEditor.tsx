// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The block editor (MASTER.md §32).
//
// It knows about *fields*, never about headings or FAQs. Everything it can
// draw comes from `paletteFor()`, which derives each block's controls from the
// block's own Zod schema — so a plugin's block appears here with no change to
// this file, which is what §24 promises.
//
// Two things worth knowing about the shape of this component:
//
// It holds the whole tree in state and saves the whole tree. Block trees are
// small (a page is tens of nodes), and a whole-document save means the server
// validates exactly what will be stored rather than reasoning about patches —
// which is also what makes `ContentRevision` a faithful record.
//
// Reordering has buttons as well as drag. Drag alone is unusable with a
// keyboard or a screen reader, and §15.7 puts a11y in the gates; the buttons
// are the real control and the dragging is a convenience on top.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  DotsSixVertical,
  Plus,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { Button, cx } from "@/ui/primitives";
import { moveBlock, type DropPosition } from "@/modules/cms/blocks/move";
import {
  collectById,
  duplicateNodes,
  EditorHistory,
  filterPalette,
  insertAfter,
  moveSiblings,
  readClipboard,
  removeNodes,
  writeClipboard,
} from "@/modules/cms/blocks/edit";
import { replaceNodes, sectionKeyOf } from "@/modules/cms/section-instances";
import { PreviewCanvas, type PreviewLabels } from "./PreviewCanvas";
import { RichField } from "./RichField";

export interface EditorField {
  name: string;
  kind: "text" | "multiline" | "rich" | "boolean" | "choice" | "list" | "asset";
  required: boolean;
  label: string;
  choices?: { value: string; label: string }[];
  itemFields?: EditorField[];
}

export interface EditorBlockType {
  type: string;
  /** Distinct palette row when several entries share a type (saved Sections). */
  paletteId?: string;
  label: string;
  container: boolean;
  fields: EditorField[];
  starter: Record<string, unknown>;
}

export interface EditorNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: EditorNode[];
}

export interface EditorLabels {
  preview: PreviewLabels;
  addBlock: string;
  cancel: string;
  remove: string;
  moveUp: string;
  moveDown: string;
  reorder: string;
  empty: string;
  addItem: string;
  removeItem: string;
  saving: string;
  saved: string;
  unsaved: string;
  saveFailed: string;
  retry: string;
  conflict: string;
  reload: string;
  keepMine: string;
  slash: string;
  undo: string;
  redo: string;
  duplicate: string;
  copy: string;
  paste: string;
  bold: string;
  italic: string;
  code: string;
  link: string;
  bullet: string;
  numbered: string;
  richHint: string;
  saveAsSection?: string;
  detachSection?: string;
  sectionName?: string;
}

/** Distinct enough per session; ids only need to be stable within a tree. */
function newId(type: string): string {
  return `${type}-${Math.random().toString(36).slice(2, 9)}`;
}

export function BlockEditor({
  initialBlocks,
  blockTypes,
  labels,
  previewSrc,
  save,
  onKeepMine,
  onReloadDraft,
  onSaveAsSection,
  onDetachSection,
}: {
  initialBlocks: EditorNode[];
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
  /** The preview page for this subject. */
  previewSrc: string;
  /** Persists the whole tree. Throws with a readable message on refusal. */
  save: (blocks: EditorNode[]) => Promise<{
    error?: string;
    version?: number;
    conflict?: boolean;
    serverVersion?: number;
    added?: number;
    removed?: number;
    changed?: number;
  }>;
  onKeepMine?: (blocks: EditorNode[], serverVersion: number) => Promise<{
    error?: string;
    version?: number;
    conflict?: boolean;
  }>;
  onReloadDraft?: () => Promise<{
    error?: string;
    version?: number;
    blocks?: EditorNode[];
  }>;
  onSaveAsSection?: (
    nodes: EditorNode[],
    name: string,
  ) => Promise<{ error?: string; instance?: EditorNode }>;
  onDetachSection?: (
    node: EditorNode,
  ) => Promise<{ error?: string; nodes?: EditorNode[] }>;
}) {
  const [blocks, setBlocks] = useState<EditorNode[]>(initialBlocks);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const history = useRef(new EditorHistory());
  /** Bumped on every successful save; reloads the canvas. */
  const [savedVersion, setSavedVersion] = useState(0);
  const [status, setStatus] = useState<
    "clean" | "dirty" | "saving" | "saved" | "failed"
  >("clean");
  const [error, setError] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const [serverVersion, setServerVersion] = useState<number | undefined>();
  const [conflictCounts, setConflictCounts] = useState<string | undefined>();

  const byType = useMemo(
    () => new Map(blockTypes.map((b) => [b.type, b])),
    [blockTypes],
  );

  // The tree as last sent, so autosave can tell a real change from a rerender.
  const savedRef = useRef(JSON.stringify(initialBlocks));
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const persist = useCallback(async () => {
    const snapshot = JSON.stringify(blocksRef.current);
    if (snapshot === savedRef.current) return;
    setStatus("saving");
    const result = await save(blocksRef.current);
    if (result.error) {
      setError(result.error);
      setConflict(Boolean(result.conflict));
      setServerVersion(result.serverVersion);
      setConflictCounts(
        result.conflict
          ? `+${result.added ?? 0} / −${result.removed ?? 0} / ~${result.changed ?? 0}`
          : undefined,
      );
      setStatus("failed");
      return;
    }
    savedRef.current = snapshot;
    setError(undefined);
    setConflict(false);
    setServerVersion(undefined);
    setConflictCounts(undefined);
    setStatus("saved");
    setSavedVersion((n) => n + 1);
  }, [save]);

  // Autosave, debounced. Deliberately not on every keystroke: each save writes
  // a ContentRevision, and a version per character would make the history
  // useless as a history.
  useEffect(() => {
    if (status !== "dirty") return;
    const timer = setTimeout(() => void persist(), 1200);
    return () => clearTimeout(timer);
  }, [blocks, status, persist]);

  const mutate = (next: EditorNode[]) => {
    history.current.push(blocksRef.current);
    setBlocks(next);
    setStatus("dirty");
  };

  const selectedSet = () => new Set(selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []);

  const applyHistory = (next: EditorNode[] | undefined) => {
    if (!next) return;
    setBlocks(next);
    setStatus("dirty");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        applyHistory(
          event.shiftKey
            ? history.current.redo(blocksRef.current)
            : history.current.undo(blocksRef.current),
        );
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        applyHistory(history.current.redo(blocksRef.current));
        return;
      }
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        mutate(duplicateNodes(blocksRef.current, selectedSet()));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        const taken = collectById(blocksRef.current, selectedSet());
        if (taken.length === 0) return;
        event.preventDefault();
        void navigator.clipboard.writeText(writeClipboard(taken));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void navigator.clipboard.readText().then((raw) => {
          const nodes = readClipboard(raw);
          if (!nodes) return;
          mutate(insertAfter(blocksRef.current, selectedId, nodes));
        });
        return;
      }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        mutate(
          moveSiblings(
            blocksRef.current,
            selectedSet(),
            event.key === "ArrowUp" ? -1 : 1,
          ),
        );
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        window.dispatchEvent(new Event("freeholder-slash"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedIds]);

  /**
   * Apply a block dragged somewhere else on the canvas.
   *
   * The decision about whether the move is legal lives in `moveBlock`, which
   * is pure and tested — a container dropped into its own child would detach
   * that branch, and a component is the wrong place to be sure about that. An
   * illegal move leaves the tree untouched, and the canvas snaps back on its
   * next render because the tree is what it renders from.
   */
  const applyMove = useCallback(
    (blockId: string, targetId: string, position: string) => {
      setBlocks((current) => {
        // No cast needed: EditorNode and BlockNode are the same shape, which
        // is the point — the editor is holding the block tree, not a parallel
        // model of it that has to be translated back and forth.
        const moved = moveBlock(current, blockId, targetId, position as DropPosition);
        return moved ?? current;
      });
      setStatus("dirty");
    },
    [],
  );

  /**
   * Apply text typed on the canvas.
   *
   * `useCallback` because the canvas subscribes to it: a new identity on every
   * render would tear down and re-add the message listener each keystroke.
   *
   * The canvas is *not* reloaded afterwards. It already shows what was typed —
   * it is where the typing happened — and refreshing the frame mid-sentence
   * would throw the caret away. The tree and the canvas agree; the save
   * catches up on its own rhythm.
   */
  const applyInlineEdit = useCallback(
    (blockId: string, prop: string, value: string) => {
      setBlocks((current) => {
        const walk = (nodes: EditorNode[]): EditorNode[] =>
          nodes.map((node) =>
            node.id === blockId
              ? { ...node, props: { ...node.props, [prop]: value } }
              : node.children
                ? { ...node, children: walk(node.children) }
                : node,
          );
        return walk(current);
      });
      setStatus("dirty");
    },
    [],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="grid gap-4">
        <SectionActions
          labels={labels}
          selected={collectById(blocks, selectedSet())}
          onSaveAsSection={onSaveAsSection}
          onDetachSection={onDetachSection}
          onReplace={(ids, next) => mutate(replaceNodes(blocks, ids, next))}
        />
        <BlockList
          nodes={blocks}
          onChange={mutate}
          byType={byType}
          blockTypes={blockTypes}
          labels={labels}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={(id, additive) => {
            setSelectedId(id);
            if (!id) {
              setSelectedIds([]);
              return;
            }
            setSelectedIds((current) => {
              if (!additive) return [id];
              return current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id];
            });
          }}
        />
        <SaveStatus
          status={status}
          error={error}
          conflict={conflict}
          conflictCounts={conflictCounts}
          labels={labels}
          onRetry={() => void persist()}
          onReload={
            onReloadDraft
              ? async () => {
                  const result = await onReloadDraft();
                  if (result.error || !result.blocks) {
                    setError(result.error ?? labels.saveFailed);
                    return;
                  }
                  setBlocks(result.blocks);
                  savedRef.current = JSON.stringify(result.blocks);
                  setConflict(false);
                  setError(undefined);
                  setStatus("saved");
                  setSavedVersion((n) => n + 1);
                }
              : undefined
          }
          onKeepMine={
            onKeepMine && serverVersion !== undefined
              ? async () => {
                  const result = await onKeepMine(blocksRef.current, serverVersion);
                  if (result.error) {
                    setError(result.error);
                    setConflict(Boolean(result.conflict));
                    setStatus("failed");
                    return;
                  }
                  savedRef.current = JSON.stringify(blocksRef.current);
                  setConflict(false);
                  setError(undefined);
                  setStatus("saved");
                  setSavedVersion((n) => n + 1);
                }
              : undefined
          }
        />
      </div>

      {/* Sticky so the canvas stays in view while the controls scroll —
          otherwise editing the fourth block means losing sight of the page. */}
      <div className="lg:sticky lg:top-4">
        <PreviewCanvas
          src={previewSrc}
          version={savedVersion}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onEdit={applyInlineEdit}
          onMove={applyMove}
          labels={labels.preview}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ status */

function SaveStatus({
  status,
  error,
  conflict,
  conflictCounts,
  labels,
  onRetry,
  onReload,
  onKeepMine,
}: {
  status: "clean" | "dirty" | "saving" | "saved" | "failed";
  error?: string;
  conflict: boolean;
  conflictCounts?: string;
  labels: EditorLabels;
  onRetry: () => void;
  onReload?: () => void | Promise<void>;
  onKeepMine?: () => void | Promise<void>;
}) {
  if (status === "clean") return null;
  if (status === "failed") {
    return (
      <p
        role="status"
        className="flex flex-wrap items-center gap-3 text-sm text-danger"
      >
        {conflict ? labels.conflict : (error ?? labels.saveFailed)}
        {conflict && conflictCounts ? (
          <span className="text-ink-muted">{conflictCounts}</span>
        ) : null}
        {conflict ? (
          <>
            <button
              type="button"
              onClick={() =>
                onReload ? void onReload() : window.location.reload()
              }
              className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
            >
              {labels.reload}
            </button>
            {onKeepMine ? (
              <button
                type="button"
                onClick={() => void onKeepMine()}
                className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
              >
                {labels.keepMine}
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
          >
            {labels.retry}
          </button>
        )}
      </p>
    );
  }
  const text = {
    dirty: labels.unsaved,
    saving: labels.saving,
    saved: labels.saved,
  }[status];
  // aria-live so the save state is announced rather than only seen.
  return (
    <p role="status" aria-live="polite" className="font-mono text-xs text-ink-muted">
      {text}
    </p>
  );
}

/* -------------------------------------------------------------- block list */

function BlockList({
  nodes,
  onChange,
  byType,
  blockTypes,
  labels,
  selectedId,
  selectedIds,
  onSelect,
}: {
  nodes: EditorNode[];
  onChange: (next: EditorNode[]) => void;
  byType: Map<string, EditorBlockType>;
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
  selectedId?: string;
  selectedIds: string[];
  onSelect: (id: string | undefined, additive?: boolean) => void;
}) {
  const [dragging, setDragging] = useState<number | undefined>();

  const move = (from: number, to: number) => {
    if (to < 0 || to >= nodes.length) return;
    const next = [...nodes];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };

  const add = (type: string, starter?: Record<string, unknown>) => {
    const definition = byType.get(type);
    if (!definition) return;
    onChange([
      ...nodes,
      {
        id: newId(type),
        type,
        props: structuredClone(starter ?? definition.starter),
        ...(definition.container ? { children: [] } : {}),
      },
    ]);
  };

  return (
    <div className="grid gap-3">
      {nodes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule px-4 py-8 text-center text-sm text-ink-muted">
          {labels.empty}
        </p>
      ) : (
        <ol className="grid list-none gap-3 p-0">
          {nodes.map((node, index) => (
            <li
              key={node.id}
              draggable
              onDragStart={() => setDragging(index)}
              onDragEnd={() => setDragging(undefined)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== undefined) move(dragging, index);
                setDragging(undefined);
              }}
              onFocusCapture={() => onSelect(node.id)}
              className={cx(
                "rounded-lg border bg-surface transition-colors",
                selectedId === node.id || selectedIds.includes(node.id)
                  ? "border-accent"
                  : "border-rule",
                dragging === index && "opacity-50",
              )}
            >
              <BlockCard
                node={node}
                selectedId={selectedId}
                selectedIds={selectedIds}
                onSelect={onSelect}
                definition={byType.get(node.type)}
                labels={labels}
                blockTypes={blockTypes}
                byType={byType}
                isFirst={index === 0}
                isLast={index === nodes.length - 1}
                onMoveUp={() => move(index, index - 1)}
                onMoveDown={() => move(index, index + 1)}
                onDuplicate={() =>
                  onChange(duplicateNodes(nodes, new Set([node.id])))
                }
                onRemove={() =>
                  onChange(removeNodes(nodes, new Set([node.id])))
                }
                onChange={(next) =>
                  onChange(nodes.map((n, i) => (i === index ? next : n)))
                }
              />
            </li>
          ))}
        </ol>
      )}

      <AddBlock blockTypes={blockTypes} labels={labels} onAdd={add} />
    </div>
  );
}

function BlockCard({
  node,
  definition,
  labels,
  blockTypes,
  byType,
  selectedId,
  selectedIds,
  onSelect,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
  onChange,
}: {
  node: EditorNode;
  definition: EditorBlockType | undefined;
  labels: EditorLabels;
  blockTypes: EditorBlockType[];
  byType: Map<string, EditorBlockType>;
  selectedId?: string;
  selectedIds: string[];
  onSelect: (id: string | undefined, additive?: boolean) => void;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onChange: (next: EditorNode) => void;
}) {
  const setProp = (name: string, value: unknown) =>
    onChange({ ...node, props: { ...node.props, [name]: value } });

  return (
    <div>
      <div
        className="flex items-center gap-2 border-b border-rule bg-surface-muted px-3 py-2"
        onClick={(event) => onSelect(node.id, event.shiftKey)}
      >
        <span
          aria-hidden="true"
          title={labels.reorder}
          className="cursor-grab text-ink-muted"
        >
          <DotsSixVertical size={15} weight="bold" />
        </span>
        <span className="text-sm font-semibold">
          {definition?.label ?? node.type}
        </span>
        <div className="ms-auto flex items-center gap-1">
          <IconButton label={labels.moveUp} onClick={onMoveUp} disabled={isFirst}>
            <ArrowUp size={14} weight="bold" />
          </IconButton>
          <IconButton label={labels.moveDown} onClick={onMoveDown} disabled={isLast}>
            <ArrowDown size={14} weight="bold" />
          </IconButton>
          <IconButton label={labels.duplicate} onClick={onDuplicate}>
            <Copy size={14} weight="bold" />
          </IconButton>
          <IconButton label={labels.remove} onClick={onRemove}>
            <Trash size={14} weight="bold" />
          </IconButton>
        </div>
      </div>

      <div className="grid gap-4 px-3 py-3">
        {(definition?.fields ?? []).map((field) => (
          <Field
            key={field.name}
            field={field}
            value={node.props[field.name]}
            onChange={(value) => setProp(field.name, value)}
            idPrefix={node.id}
            labels={labels}
          />
        ))}

        {definition?.container ? (
          <div className="border-s-2 border-rule ps-3">
            <BlockList
              nodes={node.children ?? []}
              onChange={(children) => onChange({ ...node, children })}
              byType={byType}
              blockTypes={blockTypes}
              labels={labels}
              selectedId={selectedId}
              selectedIds={selectedIds}
              onSelect={onSelect}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "rounded-md border border-rule px-1.5 py-1 text-ink-muted",
        disabled && "opacity-40",
      )}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- fields */

function Field({
  field,
  value,
  onChange,
  idPrefix,
  labels,
}: {
  field: EditorField;
  value: unknown;
  onChange: (value: unknown) => void;
  idPrefix: string;
  labels: EditorLabels;
}) {
  const id = `${idPrefix}-${field.name}`;
  const control = "w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink focus-visible:border-accent";

  if (field.kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    );
  }

  if (field.kind === "asset") {
    // Values stay strings: an asset id is a uuid, and the numeric coercion the
    // literal-union control needs would mangle it.
    return (
      <div className="grid gap-1.5">
        <label htmlFor={id} className="font-mono text-xs font-medium text-ink-muted">
          {field.label}
        </label>
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || undefined)}
          className={control}
        >
          {(field.choices ?? []).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.kind === "choice") {
    return (
      <div className="grid gap-1.5">
        <label htmlFor={id} className="font-mono text-xs font-medium text-ink-muted">
          {field.label}
        </label>
        <select
          id={id}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(event) => {
            const raw = event.target.value;
            // Literal unions are numeric on the wire for things like heading
            // level; the schema will refuse a string where it wants 2.
            const asNumber = Number(raw);
            onChange(raw !== "" && !Number.isNaN(asNumber) ? asNumber : raw);
          }}
          className={control}
        >
          {(field.choices ?? []).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.kind === "list") {
    const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    const itemFields = field.itemFields ?? [];
    return (
      <div className="grid gap-2">
        <span className="font-mono text-xs font-medium text-ink-muted">
          {field.label}
        </span>
        <ol className="grid list-none gap-2 p-0">
          {items.map((item, index) => (
            <li
              key={index}
              className="grid gap-2 rounded-md border border-rule p-2.5"
            >
              {itemFields.map((sub) => (
                <Field
                  key={sub.name}
                  field={sub}
                  value={item[sub.name]}
                  idPrefix={`${id}-${index}`}
                  labels={labels}
                  onChange={(next) =>
                    onChange(
                      items.map((row, i) =>
                        i === index ? { ...row, [sub.name]: next } : row,
                      ),
                    )
                  }
                />
              ))}
              <div>
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                  className="text-xs text-ink-muted underline decoration-rule underline-offset-2"
                >
                  {labels.removeItem}
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <button
            type="button"
            onClick={() =>
              onChange([
                ...items,
                Object.fromEntries(itemFields.map((sub) => [sub.name, ""])),
              ])
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1.5 text-xs font-medium text-ink"
          >
            <Plus size={13} weight="bold" />
            {labels.addItem}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-mono text-xs font-medium text-ink-muted">
        {field.label}
      </label>
      {field.kind === "rich" ? (
        <RichField
          id={id}
          label={field.label}
          value={value}
          onChange={onChange}
          labels={{
            bold: labels.bold,
            italic: labels.italic,
            code: labels.code,
            link: labels.link,
            bullet: labels.bullet,
            numbered: labels.numbered,
            hint: labels.richHint,
          }}
        />
      ) : field.kind === "multiline" ? (
        <textarea
          id={id}
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className={control}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className={control}
        />
      )}
    </div>
  );
}

function SectionActions({
  labels,
  selected,
  onSaveAsSection,
  onDetachSection,
  onReplace,
}: {
  labels: EditorLabels;
  selected: EditorNode[];
  onSaveAsSection?: (
    nodes: EditorNode[],
    name: string,
  ) => Promise<{ error?: string; instance?: EditorNode }>;
  onDetachSection?: (
    node: EditorNode,
  ) => Promise<{ error?: string; nodes?: EditorNode[] }>;
  onReplace: (ids: Set<string>, next: EditorNode[]) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  if (!onSaveAsSection && !onDetachSection) return null;
  if (selected.length === 0) return null;
  const only = selected.length === 1 ? selected[0] : undefined;
  const canDetach = Boolean(only && sectionKeyOf(only) && onDetachSection);
  return (
    <div className="flex flex-wrap items-end gap-2">
      {onSaveAsSection ? (
        <>
          <label className="grid gap-1">
            <span className="font-mono text-xs text-ink-muted">
              {labels.sectionName ?? "Section name"}
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
            />
          </label>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              if (!name.trim()) return;
              void onSaveAsSection(selected, name.trim()).then((result) => {
                if (result.error) {
                  setError(result.error);
                  return;
                }
                if (result.instance) {
                  onReplace(new Set(selected.map((node) => node.id)), [
                    result.instance,
                  ]);
                  setName("");
                  setError(undefined);
                }
              });
            }}
          >
            {labels.saveAsSection ?? "Save as Section"}
          </Button>
        </>
      ) : null}
      {canDetach ? (
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            void onDetachSection!(only!).then((result) => {
              if (result.error) {
                setError(result.error);
                return;
              }
              if (result.nodes) {
                onReplace(new Set([only!.id]), result.nodes);
                setError(undefined);
              }
            });
          }}
        >
          {labels.detachSection ?? "Detach"}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ add a block */

function AddBlock({
  blockTypes,
  labels,
  onAdd,
}: {
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
  onAdd: (type: string, starter?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const openSlash = () => setOpen(true);
    window.addEventListener("freeholder-slash", openSlash);
    return () => window.removeEventListener("freeholder-slash", openSlash);
  }, []);
  const matches = filterPalette(
    blockTypes.map((block) => ({
      type: block.paletteId ?? block.type,
      insertType: block.type,
      label: block.label,
      starter: block.starter,
    })),
    query,
  );

  if (!open) {
    return (
      <div>
        <Button type="button" variant="quiet" onClick={() => setOpen(true)}>
          <Plus size={15} weight="bold" />
          {labels.addBlock}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border border-rule bg-surface p-3">
      <label className="grid gap-1">
        <span className="font-mono text-xs text-ink-muted">{labels.slash}</span>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              onAdd(matches[0].insertType, matches[0].starter);
              setOpen(false);
              setQuery("");
            }
            if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          placeholder="/"
          className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
        />
      </label>
      <ul className="grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
        {matches.map((block) => (
          <li key={block.type}>
            <button
              type="button"
              onClick={() => {
                onAdd(block.insertType, block.starter);
                setOpen(false);
                setQuery("");
              }}
              className="w-full rounded-md border border-rule px-3 py-2 text-start text-sm text-ink"
            >
              {block.label}
            </button>
          </li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
          className="text-xs text-ink-muted underline decoration-rule underline-offset-2"
        >
          {labels.cancel}
        </button>
      </div>
    </div>
  );
}
