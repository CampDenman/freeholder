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
  analyzeAccessibility,
  type A11yContext,
} from "@/modules/cms/a11y-hints";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  DotsSixVertical,
  ListBullets,
  Plus,
  Trash,
  UploadSimple,
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
  setPropAtPath,
  writeClipboard,
} from "@/modules/cms/blocks/edit";
import { replaceNodes, sectionKeyOf } from "@/modules/cms/section-instances";
import {
  PreviewCanvas,
  type FrameAnchor,
  type PreviewLabels,
} from "./PreviewCanvas";
import { RichField } from "./RichField";
import { uploadMediaFile } from "./media/upload-client";
import {
  BASIS,
  clampCrop,
  clampFocal,
  cropForAspect,
  IMAGE_ASPECTS,
  imageFraming,
  isFullCrop,
  resizeCrop,
  type Focal,
  type ImageAspect,
  type ImageCrop,
} from "@/core/media/framing";

export interface EditorField {
  name: string;
  kind:
    | "text"
    | "multiline"
    | "rich"
    | "boolean"
    | "choice"
    | "list"
    | "asset"
    | "collection"
    | "product";
  required: boolean;
  label: string;
  choices?: { value: string; label: string }[];
  itemFields?: EditorField[];
  /** For `asset`: the one media kind the field accepts. */
  assetKind?: "image" | "video";
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

/**
 * The canvas image tools (C2.25): upload from the anchored picker, and the
 * crop & focal-point editor. Optional so an editor screen that cannot upload
 * (none today) simply shows neither.
 */
export interface MediaLabels {
  upload: string;
  /** "Uploading… {percent}%" */
  uploading: string;
  uploadFailed: string;
  cropTitle: string;
  /** Screen-reader name of the focal marker: "{x}% across, {y}% down". */
  focalPoint: string;
  focalHint: string;
  cropToggle: string;
  /** Screen-reader name of the crop window. */
  cropArea: string;
  corners: { nw: string; ne: string; sw: string; se: string };
  shape: string;
  aspects: Record<ImageAspect, string>;
  preview: string;
  reset: string;
  apply: string;
  loading: string;
  unavailable: string;
}

/** What the crop tool needs to draw the picture: the public resolve's answer. */
export interface CropImage {
  src: string;
  width: number | null;
  height: number | null;
  focalX: number;
  focalY: number;
}

/** One row a store picker offers — a collection or a product. */
export interface StoreChoice {
  slug: string;
  title: string;
  detail?: string | null;
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
  /** The history menu button and its states (audit gap 6). */
  history: string;
  historyCurrent: string;
  /** One history row: the action's human label. */
  historyAdd: string;
  historyRemove: string;
  historyDuplicate: string;
  historyMove: string;
  historyEdit: string;
  /** The zen/full-screen surface (audit gap 10). */
  focusMode: string;
  exitFocus: string;
  showOutlines: string;
  hideOutlines: string;
  zoom: string;
  /** The store-section pickers raised from the canvas. */
  chooseCollection: string;
  chooseProducts: string;
  noCollections: string;
  noProducts: string;
  pickedProducts: string;
  done: string;
  /** The image block's on-canvas alt editor. */
  altText: string;
  altApply: string;
  /** Upload and crop/focal on the canvas (C2.25). */
  media?: MediaLabels;
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
  /** "Live" chip — the page is published. */
  live: string;
  /** "Draft" chip — the page has never been published. */
  draft: string;
  /** Push the saved draft to the live page without unpublishing first. */
  publishChanges: string;
  publishing: string;
  publishFailed: string;
  /** Screen-reader confirmation of an editor-side move: "Moved {label} to position {position} of {total}". */
  movedTo: string;
  a11y: {
    title: string;
    ok: string;
    missingH1: string;
    multipleH1: string;
    headingOrder: string;
    imageMissing: string;
    imageAltUnset: string;
    vagueLink: string;
    emptyHref: string;
    htmlImage: string;
    htmlLandmarks: string;
    videoMissing: string;
    popupH1: string;
    popupRawHtml: string;
  };
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
  a11yContext = "page",
  published,
  save,
  onPublish,
  onKeepMine,
  onReloadDraft,
  onSaveAsSection,
  onDetachSection,
  listCollections,
  listProducts,
  uploadImage = defaultUploadImage,
  loadImage = defaultLoadImage,
}: {
  initialBlocks: EditorNode[];
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
  /** The preview page for this subject. */
  previewSrc: string;
  a11yContext?: A11yContext;
  /** Whether the subject is live — drives the draft/live chip. */
  published?: boolean;
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
  /**
   * Save the current draft and publish it in one step (audit gap 8: pushing
   * edits live must never mean unpublishing first). Only page subjects wire
   * this; without it no publish chrome renders.
   */
  onPublish?: (blocks: EditorNode[]) => Promise<{
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
  /**
   * The store pickers' data sources. Injected so the editor stays testable;
   * page subjects wire the catalog-backed server actions.
   */
  listCollections?: () => Promise<StoreChoice[]>;
  listProducts?: () => Promise<StoreChoice[]>;
  /**
   * Upload one file from the canvas picker. Defaults to the media library's
   * own resumable pipeline (upload-client.ts) — injected only so tests can
   * observe it.
   */
  uploadImage?: (
    file: File,
    options: { signal: AbortSignal; onProgress: (percent: number) => void },
  ) => Promise<{ id: string; filename: string }>;
  /** Resolve a picture for the crop tool; defaults to `media.resolveImage`. */
  loadImage?: (assetId: string) => Promise<CropImage | null>;
}) {
  const [blocks, setBlocks] = useState<EditorNode[]>(initialBlocks);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const history = useRef(new EditorHistory());
  /** Bumped on every history change so the undo chrome re-renders. */
  const [historyVersion, setHistoryVersion] = useState(0);
  /** Bumped on every successful save; reloads the canvas. */
  const [savedVersion, setSavedVersion] = useState(0);
  const [status, setStatus] = useState<
    "clean" | "dirty" | "saving" | "saved" | "failed"
  >("clean");
  const [error, setError] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const [serverVersion, setServerVersion] = useState<number | undefined>();
  const [conflictCounts, setConflictCounts] = useState<string | undefined>();
  /** Screen-reader confirmation of the last editor-side move. */
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const [publishing, setPublishing] = useState(false);
  /** The zen/full-screen surface (audit gap 10). */
  const [zen, setZen] = useState(false);
  /** Persistent block outlines on the canvas. */
  const [outlines, setOutlines] = useState(false);
  /** The canvas zoom in the zen surface. */
  const [zoom, setZoom] = useState(1);

  /**
   * Files uploaded from the canvas picker this session. The server built the
   * asset choices when the editor opened; a fresh upload joins them here so
   * the picker, the form's select and the crop tool all know it at once.
   */
  const [uploaded, setUploaded] = useState<{ value: string; label: string }[]>([]);
  const effectiveTypes = useMemo(
    () =>
      uploaded.length === 0
        ? blockTypes
        : blockTypes.map((type) => ({
            ...type,
            fields: type.fields.map((field) =>
              field.kind === "asset" && field.assetKind !== "video"
                ? {
                    ...field,
                    choices: [
                      ...(field.choices ?? []),
                      ...uploaded.filter(
                        (extra) =>
                          !(field.choices ?? []).some((choice) => choice.value === extra.value),
                      ),
                    ],
                  }
                : field,
            ),
          })),
    [blockTypes, uploaded],
  );
  const byType = useMemo(
    () => new Map(effectiveTypes.map((b) => [b.type, b])),
    [effectiveTypes],
  );

  const blockLabel = useCallback(
    (type: string | undefined) => (type ? (byType.get(type)?.label ?? type) : ""),
    [byType],
  );

  /** A history label from one of the templates, naming the block. */
  const historyLabel = useCallback(
    (template: string, type: string | undefined) =>
      template.replace("{label}", blockLabel(type)),
    [blockLabel],
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
    setStatus(JSON.stringify(blocksRef.current) === snapshot ? "saved" : "dirty");
    setSavedVersion((n) => n + 1);
  }, [save]);

  /**
   * Commit the next tree: history record, the ref the autosave snapshots, and
   * React state, in that order — the ref must read as the new tree before
   * anything awaits, which is what lets a structural canvas edit save
   * immediately instead of waiting out the debounce.
   *
   * `editKey` coalesces: typing into one field (canvas or form) extends the
   * open record rather than stacking one entry per keystroke. Any edit
   * without a key (add, move, remove) closes the run.
   */
  const mutate = useCallback(
    (next: EditorNode[], options?: { label?: string; editKey?: string }) => {
      const current = blocksRef.current;
      history.current.push(
        current,
        options?.label ?? labels.historyEdit.replace("{label}", ""),
        next,
        options?.editKey,
      );
      blocksRef.current = next;
      setBlocks(next);
      setStatus("dirty");
      setHistoryVersion((n) => n + 1);
    },
    [labels.historyEdit],
  );

  // Autosave, debounced. Deliberately not on every keystroke: each save writes
  // a ContentRevision, and a version per character would make the history
  // useless as a history.
  useEffect(() => {
    if (status !== "dirty") return;
    const timer = setTimeout(() => void persist(), 1200);
    return () => clearTimeout(timer);
  }, [blocks, status, persist]);

  /**
   * Push the current draft live in one step (audit gap 8).
   *
   * The save runs first so the publish validates exactly what the owner sees;
   * `onPublish` performs both. The live page is never taken down to come back
   * up — `cms.publishPage` copies the draft over the published tree in one
   * transaction, so the storefront cannot 404 mid-flow.
   */
  const publishNow = useCallback(async () => {
    if (!onPublish || publishing) return;
    setPublishing(true);
    const snapshot = JSON.stringify(blocksRef.current);
    try {
      const result = await onPublish(blocksRef.current);
      if (result.error) {
        setError(result.error);
        setConflict(Boolean(result.conflict));
        setServerVersion(result.serverVersion);
        setConflictCounts(result.conflict
          ? `+${result.added ?? 0} / −${result.removed ?? 0} / ~${result.changed ?? 0}`
          : undefined);
        setStatus("failed");
        return;
      }
      savedRef.current = snapshot;
      setError(undefined);
      setConflict(false);
      setStatus(JSON.stringify(blocksRef.current) === snapshot ? "saved" : "dirty");
      setSavedVersion((n) => n + 1);
    } catch {
      // A transport error can arrive after the server committed. Ask the owner
      // to check the live page before retrying rather than claiming no change.
      setError(labels.publishFailed);
      setStatus("failed");
    } finally {
      setPublishing(false);
    }
  }, [onPublish, publishing, labels.publishFailed]);

  /**
   * Confirm an editor-side move to screen readers: which block, and where it
   * now sits. Canvas-side moves (drops, grip arrows) announce inside the
   * frame instead, where grip focus lives, so a move is never announced twice.
   *
   * `tree` is the tree *after* the move: the callers pass the tree they just
   * committed, because the state ref still reads as the move's origin until
   * React commits.
   */
  const announcePosition = useCallback((
    blockId: string | undefined,
    tree?: EditorNode[],
  ) => {
    if (!blockId) return;
    const source = tree ?? blocksRef.current;
    const positionOf = (
      nodes: EditorNode[],
    ): { index: number; total: number } | undefined => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i]!.id === blockId) return { index: i + 1, total: nodes.length };
        const children = nodes[i]!.children;
        if (children) {
          const hit = positionOf(children);
          if (hit) return hit;
        }
      }
      return undefined;
    };
    const node = collectById(source, new Set([blockId]))[0];
    const position = positionOf(source);
    if (!node || !position) return;
    const label = byType.get(node.type)?.label ?? node.type;
    setMoveAnnouncement(
      labels.movedTo
        .replace("{label}", label)
        .replace("{position}", String(position.index))
        .replace("{total}", String(position.total)),
    );
  }, [byType, labels.movedTo]);

  const selectedSet = () => new Set(selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []);

  /**
   * Undo and redo (audit gap 6 — the buttons and the history menu above the
   * canvas route here, and so do Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y). The
   * keyboard shortcuts were always there; the visible chrome is what makes
   * them discoverable.
   */
  const applyHistory = useCallback((next: EditorNode[] | undefined) => {
    if (!next) return;
    history.current.breakRun();
    blocksRef.current = next;
    setBlocks(next);
    setStatus("dirty");
    setHistoryVersion((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    applyHistory(history.current.undo(blocksRef.current));
  }, [applyHistory]);

  const redo = useCallback(() => {
    applyHistory(history.current.redo(blocksRef.current));
  }, [applyHistory]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const taken = collectById(blocksRef.current, selectedSet());
        mutate(duplicateNodes(blocksRef.current, selectedSet()), {
          label: taken[0]
            ? historyLabel(labels.historyDuplicate, taken[0].type)
            : undefined,
        });
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
          mutate(insertAfter(blocksRef.current, selectedId, nodes), {
            label: historyLabel(labels.historyAdd, nodes[0]?.type),
          });
        });
        return;
      }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const selected = collectById(blocksRef.current, selectedSet());
        const next = moveSiblings(
          blocksRef.current,
          selectedSet(),
          event.key === "ArrowUp" ? -1 : 1,
        );
        mutate(next, {
          label: historyLabel(labels.historyMove, selected[0]?.type),
        });
        // `selectedIds` mirrors even a single selection, so one entry is
        // exactly the "one block selected" case worth announcing.
        const only = selectedIds.length === 1 ? selectedIds[0] : undefined;
        announcePosition(only, next);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        window.dispatchEvent(new Event("freeholder-slash"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedIds, announcePosition, undo, redo, mutate, historyLabel, labels]);

  /**
   * Apply a block dragged somewhere else on the canvas.
   *
   * The decision about whether the move is legal lives in `moveBlock`, which
   * is pure and tested — a container dropped into its own child would detach
   * that branch, and a component is the wrong place to be sure about that. An
   * illegal move leaves the tree untouched and marks nothing dirty: the
   * canvas did not move its DOM either, so a refused drop simply never lands.
   */
  const applyMove = useCallback(
    (blockId: string, targetId: string, position: string) => {
      const current = blocksRef.current;
      // No cast needed: EditorNode and BlockNode are the same shape, which
      // is the point — the editor is holding the block tree, not a parallel
      // model of it that has to be translated back and forth.
      const moved = moveBlock(current, blockId, targetId, position as DropPosition);
      if (!moved) return;
      const movedNode = collectById(current, new Set([blockId]))[0];
      history.current.push(
        current,
        historyLabel(labels.historyMove, movedNode?.type),
        moved,
      );
      blocksRef.current = moved;
      setBlocks(moved);
      setStatus("dirty");
      setHistoryVersion((n) => n + 1);
    },
    [historyLabel, labels.historyMove],
  );

  /**
   * Apply an edit made directly on the canvas.
   *
   * `useCallback` because the canvas subscribes to it: a new identity on every
   * render would tear down and re-add the message listener each keystroke.
   *
   * `prop` is usually a flat prop ("text"); it can also be a dotted path into
   * an array prop ("items.0.question"), and `value` anything the prop holds —
   * a string for a text edit, the typed document for a rich region, a slug
   * for a store source. The path walk lives in `setPropAtPath`, shared with
   * nothing else because nothing else needs it.
   *
   * Continuous typing into the same prop is one history record (the editKey
   * coalesces), and the ref is committed synchronously so a structural edit
   * — a swapped collection, a re-picked row — can persist immediately and
   * let the canvas's invisible reload show the new shelf at once instead of
   * waiting out the debounce.
   *
   * The canvas is *not* reloaded afterwards for plain text. It already shows
   * what was typed — it is where the typing happened — and refreshing the
   * frame mid-sentence would throw the caret away. The tree and the canvas
   * agree; the save catches up on its own rhythm.
   */
  const applyInlineEdit = useCallback(
    (blockId: string, prop: string, value: unknown, options?: { structural?: boolean }) => {
      const current = blocksRef.current;
      const walk = (nodes: EditorNode[]): EditorNode[] =>
        nodes.map((node) =>
          node.id === blockId
            ? { ...node, props: setPropAtPath(node.props, prop, value) }
            : node.children
              ? { ...node, children: walk(node.children) }
              : node,
        );
      const next = walk(current);
      if (next === current) return;
      const node = collectById(current, new Set([blockId]))[0];
      history.current.push(
        current,
        historyLabel(labels.historyEdit, node?.type),
        next,
        `${blockId}:${prop}`,
      );
      blocksRef.current = next;
      setBlocks(next);
      setStatus("dirty");
      setHistoryVersion((n) => n + 1);
      if (options?.structural) void persist();
    },
    [historyLabel, labels.historyEdit, persist],
  );

  /**
   * Several props of one block as one edit and one history record — the
   * crop tool's apply (crop, focal point and frame shape together), and an
   * asset swap that drops the old picture's crop. Structural: the canvas
   * cannot repaint a crop from the draft, so it saves at once and the
   * invisible reload shows the server's own rendering of the result.
   */
  const applyPropsEdit = useCallback(
    (blockId: string, patch: Record<string, unknown>, options?: { structural?: boolean }) => {
      const current = blocksRef.current;
      const walk = (nodes: EditorNode[]): EditorNode[] =>
        nodes.map((node) => {
          if (node.id === blockId) {
            let props = node.props;
            for (const [key, value] of Object.entries(patch)) {
              props = setPropAtPath(props, key, value);
            }
            return { ...node, props };
          }
          return node.children ? { ...node, children: walk(node.children) } : node;
        });
      const next = walk(current);
      const node = collectById(current, new Set([blockId]))[0];
      if (!node) return;
      history.current.push(current, historyLabel(labels.historyEdit, node.type), next);
      blocksRef.current = next;
      setBlocks(next);
      setStatus("dirty");
      setHistoryVersion((n) => n + 1);
      if (options?.structural) void persist();
    },
    [historyLabel, labels.historyEdit, persist],
  );

  // A replace affordance on the canvas — an image's, or a commerce block's
  // collection/product pick — raises the anchored picker; the pick itself is
  // an ordinary canvas edit (the named prop) from there on.
  const [propPick, setPropPick] = useState<
    | { blockId: string; prop: string; x: number; y: number }
    | undefined
  >();
  // The store sections' source affordances and the image's alt affordance
  // raise anchored popovers; a store pick is *structural* — it changes what
  // the server must resolve — so it saves immediately and the canvas's
  // invisible reload shows the new shelf at once.
  const [collectionPick, setCollectionPick] = useState<StorePick | undefined>();
  const [productPickState, setProductPickState] = useState<StorePick | undefined>();
  const [altEdit, setAltEdit] = useState<StorePick | undefined>();
  const [cropEdit, setCropEdit] = useState<
    { blockId: string; x: number; y: number } | undefined
  >();

  const pickerFor = (pick: { blockId: string; prop: string }) => {
    const node = collectById(blocksRef.current, new Set([pick.blockId]))[0];
    const field = node
      ? byType
          .get(node.type)
          ?.fields.find(
            (f) =>
              f.name === pick.prop &&
              (f.kind === "asset" || f.kind === "collection" || f.kind === "product"),
          )
      : undefined;
    if (!field) return undefined;
    // The field's own choices carry the translated "None" entry, exactly as
    // the form panel's select renders it — one library, two doors.
    const preview = labels.preview;
    const meta =
      field.kind === "asset"
        ? { label: preview.replaceImage, empty: preview.noAssets }
        : field.kind === "collection"
          ? { label: preview.replaceCollection, empty: preview.noCollections }
          : { label: preview.replaceProduct, empty: preview.noProducts };
    return {
      choices: field.choices ?? [],
      ...meta,
      // Upload rides the picker for image fields (the audit's gap 7): the
      // file goes through the media library's own resumable pipeline.
      uploadable: field.kind === "asset" && field.assetKind !== "video",
    };
  };

  const activePicker = propPick ? pickerFor(propPick) : undefined;

  // Stable identities matter: PreviewCanvas subscribes to these, and a new
  // function per render would tear the message listener down and re-add it on
  // every keystroke — measured as ~2ms of keystroke→preview regression.
  const handleAssetPick = useCallback(
    (blockId: string, prop: string, anchor: FrameAnchor) =>
      setPropPick({ blockId, prop, x: anchor.x, y: anchor.y }),
    [],
  );
  const handleCollectionPick = useCallback(
    (blockId: string, prop: string, current: string, anchor: FrameAnchor) =>
      setCollectionPick({ blockId, prop, current, x: anchor.x, y: anchor.y }),
    [],
  );
  const handleProductPick = useCallback(
    (blockId: string, prop: string, current: string, anchor: FrameAnchor) =>
      setProductPickState({ blockId, prop, current, x: anchor.x, y: anchor.y }),
    [],
  );
  const handleAltEdit = useCallback(
    (blockId: string, prop: string, current: string, anchor: FrameAnchor) =>
      setAltEdit({ blockId, prop, current, x: anchor.x, y: anchor.y }),
    [],
  );
  const handleCropEdit = useCallback(
    (blockId: string, _prop: string, anchor: FrameAnchor) =>
      setCropEdit({ blockId, x: anchor.x, y: anchor.y }),
    [],
  );

  /**
   * Choosing an asset from the picker. A different picture drops the old
   * one's crop and focal override — a rectangle drawn on one photograph means
   * nothing on another — in the same history record as the swap.
   */
  const pickAsset = useCallback(
    (blockId: string, prop: string, value: string | undefined) => {
      const node = collectById(blocksRef.current, new Set([blockId]))[0];
      const framed =
        node &&
        prop === "assetId" &&
        node.props[prop] !== value &&
        (node.props.crop !== undefined ||
          node.props.focalX !== undefined ||
          node.props.focalY !== undefined);
      if (framed) {
        applyPropsEdit(blockId, {
          [prop]: value,
          crop: undefined,
          focalX: undefined,
          focalY: undefined,
        });
      } else {
        applyInlineEdit(blockId, prop, value);
      }
    },
    [applyInlineEdit, applyPropsEdit],
  );
  const cropNode = cropEdit
    ? collectById(blocks, new Set([cropEdit.blockId]))[0]
    : undefined;

  const canvasProps = {
    src: previewSrc,
    version: savedVersion,
    draft: blocks,
    selectedId,
    onSelect: setSelectedId,
    onEdit: applyInlineEdit,
    onMove: applyMove,
    // Media assets and commerce entity picks both raise the one anchored
    // picker (#453's unified propPick); the store sections' source swaps and
    // the image's alt editor raise their own.
    onAssetPick: handleAssetPick,
    onPropPick: handleAssetPick,
    onCollectionPick: handleCollectionPick,
    onProductPick: handleProductPick,
    onAltEdit: handleAltEdit,
    onCropEdit: labels.media ? handleCropEdit : undefined,
    outlines,
    labels: labels.preview,
  } as const;

  // The history snapshot the toolbar renders. `historyVersion` is read here
  // so every push/undo/redo/jump re-renders the chrome even though the stack
  // itself lives in a ref.
  const historyState =
    historyVersion < 0
      ? { undoable: [], redoable: [] }
      : history.current.entries();

  return (
    <div className="grid gap-4">
      <EditorToolbar
        labels={labels}
        canUndo={history.current.canUndo()}
        canRedo={history.current.canRedo()}
        history={historyState}
        onUndo={undo}
        onRedo={redo}
        onJump={(kind, index) => {
          const tree =
            kind === "undo"
              ? history.current.restoreUndo(index, blocksRef.current)
              : history.current.restoreRedo(index, blocksRef.current);
          applyHistory(tree);
        }}
        zen={zen}
        onToggleZen={() => setZen((value) => !value)}
      />

      <div
        className={cx("grid gap-6 lg:grid-cols-2 lg:items-start", zen && "hidden")}
        aria-hidden={zen}
        inert={zen ? true : undefined}
      >
        <div className="grid gap-4">
          <SectionActions
            labels={labels}
            selected={collectById(blocks, selectedSet())}
            onSaveAsSection={onSaveAsSection}
            onDetachSection={onDetachSection}
            onReplace={(ids, next) =>
              mutate(replaceNodes(blocks, ids, next), {
                label: historyLabel(
                  labels.historyAdd,
                  collectById(blocks, ids)[0]?.type,
                ),
              })
            }
          />
          <BlockList
            nodes={blocks}
            onChange={mutate}
            byType={byType}
            blockTypes={effectiveTypes}
            labels={labels}
            selectedId={selectedId}
            selectedIds={selectedIds}
            historyLabel={historyLabel}
            onAnnounce={announcePosition}
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
          <A11yHints
            hints={analyzeAccessibility(blocks, { context: a11yContext })}
            labels={labels.a11y}
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
          {/* Announces editor-side moves to screen readers; canvas-side moves
              announce inside the frame, where grip focus lives. aria-live
              without role="status" so the save status stays the only status. */}
          <p className="sr-only" aria-live="polite">
            {moveAnnouncement}
          </p>
          {onPublish ? (
            <PublishControl
              published={published === true}
              busy={publishing}
              labels={labels}
              onPublish={() => void publishNow()}
            />
          ) : null}
        </div>

        {/* Sticky so the canvas stays in view while the controls scroll —
            otherwise editing the fourth block means losing sight of the page. */}
        <div className="lg:sticky lg:top-4">
          <PreviewCanvas {...canvasProps} />
        </div>
      </div>

      {/* The zen surface (audit gap 10): the page at its true height, the
          canvas as the primary surface, persistent outlines and a zoom — the
          admin chrome steps aside entirely. */}
      {zen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={labels.focusMode}
          className="fixed inset-0 z-50 grid grid-rows-[auto_1fr] bg-paper"
          onKeyDown={(event) => {
            if (event.key === "Escape") setZen(false);
          }}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-surface px-4 py-2">
            <Button type="button" variant="quiet" onClick={() => setZen(false)}>
              {labels.exitFocus}
            </Button>
            <button
              type="button"
              aria-pressed={outlines}
              onClick={() => setOutlines((value) => !value)}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1.5 text-xs font-medium",
                outlines ? "bg-accent text-on-accent" : "text-ink-muted",
              )}
            >
              <ListBullets size={14} weight="bold" />
              {outlines ? labels.hideOutlines : labels.showOutlines}
            </button>
            <label className="ms-auto flex items-center gap-2 text-xs font-medium text-ink-muted">
              {labels.zoom}
              <select
                value={String(zoom)}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="rounded-md border border-rule bg-field px-2 py-1 text-xs text-ink"
              >
                {["1", "0.75", "0.5"].map((value) => (
                  <option key={value} value={value}>
                    {Math.round(Number(value) * 100)}%
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-auto">
            <div
              style={{ zoom }}
              className="mx-auto w-full max-w-[80rem] px-4 py-6"
            >
              <PreviewCanvas {...canvasProps} heightMode="auto" />
            </div>
          </div>
        </div>
      ) : null}

      {/* The anchored popovers ride above everything, zen surface included. */}
      {propPick && activePicker ? (
        <AnchoredPicker
          choices={activePicker.choices}
          x={propPick.x}
          y={propPick.y}
          label={activePicker.label}
          emptyLabel={activePicker.empty}
          cancelLabel={labels.cancel}
          onPick={(value) => {
            // An empty pick clears the prop, as the form select does.
            pickAsset(propPick.blockId, propPick.prop, value || undefined);
            setPropPick(undefined);
          }}
          onClose={() => setPropPick(undefined)}
          upload={
            activePicker.uploadable && labels.media
              ? {
                  labels: labels.media,
                  send: uploadImage,
                  onUploaded: (asset) => {
                    // The new file joins the library's choices and lands on
                    // the block in one step — upload *is* the pick.
                    setUploaded((current) => [
                      ...current.filter((entry) => entry.value !== asset.id),
                      { value: asset.id, label: asset.filename },
                    ]);
                    pickAsset(propPick.blockId, propPick.prop, asset.id);
                    setPropPick(undefined);
                  },
                }
              : undefined
          }
        />
      ) : null}
      {collectionPick && listCollections ? (
        <CollectionPicker
          load={listCollections}
          current={collectionPick.current}
          x={collectionPick.x}
          y={collectionPick.y}
          label={labels.chooseCollection}
          emptyLabel={labels.noCollections}
          cancelLabel={labels.cancel}
          onPick={(slug) => {
            applyInlineEdit(collectionPick.blockId, collectionPick.prop, slug, {
              structural: true,
            });
            setCollectionPick(undefined);
          }}
          onClose={() => setCollectionPick(undefined)}
        />
      ) : null}
      {productPickState && listProducts ? (
        <ProductPicker
          load={listProducts}
          current={productPickState.current}
          x={productPickState.x}
          y={productPickState.y}
          label={labels.chooseProducts}
          doneLabel={labels.done}
          pickedLabel={labels.pickedProducts}
          emptyLabel={labels.noProducts}
          cancelLabel={labels.cancel}
          onPick={(slugs) => {
            applyInlineEdit(
              productPickState.blockId,
              productPickState.prop,
              slugs.map((slug) => ({ slug })),
              { structural: true },
            );
            setProductPickState(undefined);
          }}
          onClose={() => setProductPickState(undefined)}
        />
      ) : null}
      {altEdit ? (
        <AltEditor
          initial={altEdit.current}
          x={altEdit.x}
          y={altEdit.y}
          label={labels.altText}
          applyLabel={labels.altApply}
          cancelLabel={labels.cancel}
          onApply={(value) => {
            applyInlineEdit(altEdit.blockId, altEdit.prop, value || undefined);
            setAltEdit(undefined);
          }}
          onClose={() => setAltEdit(undefined)}
        />
      ) : null}
      {cropEdit && labels.media && typeof cropNode?.props.assetId === "string" ? (
        <CropFocalEditor
          key={`${cropEdit.blockId}:${cropNode.props.assetId}`}
          assetId={cropNode.props.assetId}
          initial={{
            crop: cropNode.props.crop as ImageCrop | undefined,
            focalX: cropNode.props.focalX as number | undefined,
            focalY: cropNode.props.focalY as number | undefined,
            aspect: (cropNode.props.aspect as ImageAspect | undefined) ?? "original",
          }}
          x={cropEdit.x}
          y={cropEdit.y}
          labels={labels.media}
          cancelLabel={labels.cancel}
          load={loadImage}
          onApply={(patch) => {
            applyPropsEdit(cropEdit.blockId, patch, { structural: true });
            setCropEdit(undefined);
          }}
          onClose={() => setCropEdit(undefined)}
        />
      ) : null}
    </div>
  );
}

/** An anchored store-source pick raised from the canvas. */
interface StorePick {
  blockId: string;
  prop: string;
  current: string;
  x: number;
  y: number;
}

/* -------------------------------------------------------------- toolbar */

/**
 * The editor's own chrome (audit gaps 6 and 10): visible undo and redo with
 * disabled states, a history menu listing every recorded edit, and the way
 * into the zen surface. The keyboard shortcuts survive; they are no longer
 * the only door.
 */
function EditorToolbar({
  labels,
  canUndo,
  canRedo,
  history,
  onUndo,
  onRedo,
  onJump,
  zen,
  onToggleZen,
}: {
  labels: EditorLabels;
  canUndo: boolean;
  canRedo: boolean;
  history: { undoable: { label: string; at: number }[]; redoable: { label: string; at: number }[] };
  onUndo: () => void;
  onRedo: () => void;
  onJump: (kind: "undo" | "redo", index: number) => void;
  zen: boolean;
  onToggleZen: () => void;
}) {
  const count = history.undoable.length + history.redoable.length;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="quiet" onClick={onUndo} disabled={!canUndo}>
        {labels.undo}
      </Button>
      <Button type="button" variant="quiet" onClick={onRedo} disabled={!canRedo}>
        {labels.redo}
      </Button>
      <details className="relative">
        <summary
          className={cx(
            "inline-flex cursor-pointer list-none items-center rounded-md border border-rule px-2.5 py-1.5 text-xs font-medium",
            count > 0 ? "text-ink" : "text-ink-muted",
          )}
        >
          {labels.history}
          {count > 0 ? ` (${count})` : ""}
        </summary>
        <div className="absolute start-0 z-40 mt-1 w-72 rounded-lg border border-rule bg-surface p-2 shadow-float">
          {history.undoable.length === 0 && history.redoable.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-ink-muted">
              {labels.historyCurrent}
            </p>
          ) : (
            <ol className="grid max-h-64 list-none gap-0.5 overflow-auto p-0">
              {history.undoable.map((entry, index) => (
                <li key={`u-${index}-${entry.at}`}>
                  <button
                    type="button"
                    onClick={() => onJump("undo", index)}
                    className="w-full rounded-md px-2.5 py-1.5 text-start text-sm text-ink-muted hover:bg-surface-muted focus-visible:bg-surface-muted"
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
              <li
                aria-current="true"
                className="rounded-md bg-accent-soft px-2.5 py-1.5 text-sm font-medium text-accent"
              >
                {labels.historyCurrent}
              </li>
              {history.redoable.map((entry, index) => (
                <li key={`r-${index}-${entry.at}`}>
                  <button
                    type="button"
                    onClick={() => onJump("redo", index)}
                    className="w-full rounded-md px-2.5 py-1.5 text-start text-sm text-ink-muted hover:bg-surface-muted focus-visible:bg-surface-muted"
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>
      <Button type="button" variant="quiet" onClick={onToggleZen} className="ms-auto">
        {zen ? labels.exitFocus : labels.focusMode}
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------------- a11y */

function A11yHints({
  hints,
  labels,
}: {
  hints: ReturnType<typeof analyzeAccessibility>;
  labels: EditorLabels["a11y"];
}) {
  return (
    <section
      aria-label={labels.title}
      className="grid gap-2 rounded-lg border border-rule bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink">{labels.title}</h2>
      {hints.length === 0 ? (
        <p className="text-sm text-ink-muted">{labels.ok}</p>
      ) : (
        <ul className="grid gap-1.5 text-sm">
          {hints.map((hint, index) => (
            <li
              key={`${hint.code}-${hint.blockId ?? index}`}
              className={hint.severity === "error" ? "text-danger" : "text-ink-muted"}
            >
              {labels[hint.code]}
            </li>
          ))}
        </ul>
      )}
    </section>
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

/* ---------------------------------------------------------------- publish */

/**
 * The audit's gap 8: one obvious way to push draft edits live.
 *
 * A draft/live chip says which state the page is in, and — while the page is
 * live — a single "Publish changes" action saves the draft and publishes it
 * atomically. Taking the site down to bring it back up is never part of the
 * flow; the header's Unpublish toggle stays as the separate, scarier action.
 */
function PublishControl({
  published,
  busy,
  labels,
  onPublish,
}: {
  published: boolean;
  busy: boolean;
  labels: EditorLabels;
  onPublish: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={cx(
          "rounded-full px-2.5 py-0.5 text-xs font-semibold",
          published
            ? "bg-success-soft text-success"
            : "bg-surface-muted text-ink-muted",
        )}
      >
        {published ? labels.live : labels.draft}
      </span>
      {published ? (
        <Button type="button" onClick={onPublish} disabled={busy}>
          {busy ? labels.publishing : labels.publishChanges}
        </Button>
      ) : null}
    </div>
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
  historyLabel,
  onSelect,
  onAnnounce,
}: {
  nodes: EditorNode[];
  onChange: (
    next: EditorNode[],
    options?: { label?: string; editKey?: string },
  ) => void;
  byType: Map<string, EditorBlockType>;
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
  selectedId?: string;
  selectedIds: string[];
  historyLabel: (template: string, type: string | undefined) => string;
  onSelect: (id: string | undefined, additive?: boolean) => void;
  /** Confirms an editor-side reorder to screen readers, with the tree it produced. */
  onAnnounce?: (blockId: string, tree?: EditorNode[]) => void;
}) {
  const [dragging, setDragging] = useState<number | undefined>();

  const move = (from: number, to: number) => {
    if (to < 0 || to >= nodes.length) return;
    const next = [...nodes];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next, { label: historyLabel(labels.historyMove, moved?.type) });
    onAnnounce?.(moved!.id, next);
  };

  const add = (type: string, starter?: Record<string, unknown>) => {
    const definition = byType.get(type);
    if (!definition) return;
    onChange(
      [
        ...nodes,
        {
          id: newId(type),
          type,
          props: structuredClone(starter ?? definition.starter),
          ...(definition.container ? { children: [] } : {}),
        },
      ],
      { label: historyLabel(labels.historyAdd, type) },
    );
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
                historyLabel={historyLabel}
                isFirst={index === 0}
                isLast={index === nodes.length - 1}
                onAnnounce={onAnnounce}
                onMoveUp={() => move(index, index - 1)}
                onMoveDown={() => move(index, index + 1)}
                onDuplicate={() =>
                  onChange(duplicateNodes(nodes, new Set([node.id])), {
                    label: historyLabel(labels.historyDuplicate, node.type),
                  })
                }
                onRemove={() =>
                  onChange(removeNodes(nodes, new Set([node.id])), {
                    label: historyLabel(labels.historyRemove, node.type),
                  })
                }
                onChange={(next, options) =>
                  onChange(nodes.map((n, i) => (i === index ? next : n)), options)
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
  historyLabel,
  onSelect,
  isFirst,
  isLast,
  onAnnounce,
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
  historyLabel: (template: string, type: string | undefined) => string;
  onSelect: (id: string | undefined, additive?: boolean) => void;
  isFirst: boolean;
  isLast: boolean;
  onAnnounce?: (blockId: string, tree?: EditorNode[]) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onChange: (
    next: EditorNode,
    options?: { label?: string; editKey?: string },
  ) => void;
}) {
  // A form-field edit coalesces with the typing run of the same field
  // (same edit key the canvas uses), so undo steps are whole edits.
  const setProp = (name: string, value: unknown) =>
    onChange(
      { ...node, props: { ...node.props, [name]: value } },
      {
        label: historyLabel(labels.historyEdit, node.type),
        editKey: `${node.id}:${name}`,
      },
    );

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
              onChange={(children, options) =>
                onChange({ ...node, children }, options)
              }
              byType={byType}
              blockTypes={blockTypes}
              labels={labels}
              selectedId={selectedId}
              selectedIds={selectedIds}
              historyLabel={historyLabel}
              onSelect={onSelect}
              onAnnounce={onAnnounce}
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

  if (field.kind === "asset" || field.kind === "collection" || field.kind === "product") {
    // Values stay strings: an asset id is a uuid, a collection/product pick
    // is a public slug, and the numeric coercion the literal-union control
    // needs would mangle both. All three pick from choices the server
    // resolved (media library, published collections, active products), so
    // the form select and the on-canvas picker draw from one list.
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

/* --------------------------------------------------------- choice picker */

/**
 * Choosing the value a canvas replace affordance names — the image block's
 * asset, a commerce block's collection or product — raised from the block's
 * own on-canvas button and anchored next to it.
 *
 * A pick is an ordinary canvas edit (the tree's named prop), so the canvas
 * swaps the value through the same draft broadcast as a keystroke and the
 * autosave persists it like one. One picker, three entity kinds: the field
 * descriptor's translated choices and the caller's labels do the shaping.
 */
function AnchoredPicker({
  choices,
  x,
  y,
  label,
  emptyLabel,
  cancelLabel,
  onPick,
  onClose,
  upload,
}: {
  /** Present for image fields: an upload through the media pipeline. */
  upload?: PickerUpload;
  /** The field's choices, "None" first, exactly as the form shows them. */
  choices: { value: string; label: string }[];
  /** Physical viewport coordinates the canvas reported for the block. */
  x: number;
  y: number;
  label: string;
  /** Shown above the list when there is nothing to pick yet. */
  emptyLabel: string;
  cancelLabel: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  // Anchor next to the block through logical margins: the block axis never
  // flips, and the inline offset is computed from the physical x in whichever
  // direction the document runs, so RTL admins anchor just as LTR ones do.
  const width = 256; // w-64
  const inlineStart =
    document.documentElement.dir === "rtl"
      ? Math.max(8, window.innerWidth - x - width)
      : Math.max(8, Math.min(x, Math.max(8, window.innerWidth - width - 8)));
  const blockStart = Math.max(8, Math.min(y, Math.max(8, window.innerHeight - 280)));
  const hasAssets = choices.some((choice) => choice.value !== "");
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-label={label}
        className="fixed start-0 top-0 w-64 rounded-lg border border-rule bg-surface p-2 shadow-raised"
        style={{
          marginInlineStart: inlineStart,
          marginBlockStart: blockStart,
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        {upload ? <PickerUploadControl upload={upload} /> : null}
        {hasAssets ? null : (
          <p className="px-2 py-1.5 text-sm text-ink-muted">{emptyLabel}</p>
        )}
        <ul className="grid max-h-56 list-none gap-1 overflow-auto p-0">
          {choices.map((choice) => (
            <li key={choice.value || "none"}>
              <button
                type="button"
                autoFocus={choice === choices[0]}
                onClick={() => onPick(choice.value)}
                className="w-full truncate rounded-md px-2.5 py-1.5 text-start text-sm text-ink hover:bg-surface-muted focus-visible:bg-surface-muted"
              >
                {choice.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-rule pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-xs text-ink-muted underline decoration-rule underline-offset-2"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The picker's upload door (C2.25): one file, the library's own pipeline. */
interface PickerUpload {
  labels: MediaLabels;
  send: (
    file: File,
    options: { signal: AbortSignal; onProgress: (percent: number) => void },
  ) => Promise<{ id: string; filename: string }>;
  onUploaded: (asset: { id: string; filename: string }) => void;
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/avif";

/**
 * Upload from the anchored picker. The file travels the media library's
 * resumable pipeline (reservation, parts or bounded proxy, validation, scan,
 * dedupe, provenance) and the Asset it becomes is applied to the block the
 * moment it exists — no trip to the library, no second pick.
 */
function PickerUploadControl({ upload }: { upload: PickerUpload }) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const [progress, setProgress] = useState<number | undefined>();
  const [failed, setFailed] = useState<string | undefined>();
  useEffect(() => () => controller.current?.abort(), []);
  const labels = upload.labels;
  return (
    <div className="mb-1 grid gap-1 border-b border-rule pb-2">
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        aria-label={labels.upload}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          setFailed(undefined);
          setProgress(0);
          controller.current = new AbortController();
          upload
            .send(file, { signal: controller.current.signal, onProgress: setProgress })
            .then((asset) => {
              setProgress(undefined);
              upload.onUploaded(asset);
            })
            .catch((error: unknown) => {
              setProgress(undefined);
              if ((error as Error)?.name === "AbortError") return;
              setFailed(error instanceof Error && error.message ? error.message : labels.uploadFailed);
            });
        }}
      />
      <button
        type="button"
        disabled={progress !== undefined}
        onClick={() => input.current?.click()}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-rule-strong bg-field px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted focus-visible:bg-surface-muted disabled:opacity-60"
      >
        <UploadSimple size={14} weight="bold" />
        {labels.upload}
      </button>
      {progress !== undefined ? (
        <div className="grid gap-1" aria-live="polite">
          <span className="text-xs text-ink-muted">
            {labels.uploading.replace("{percent}", String(progress))}
          </span>
          <progress className="h-1.5 w-full accent-accent" max={100} value={progress} />
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="text-xs text-danger">
          {failed}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------ crop & focal tool */

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

function cornerPoint(crop: ImageCrop, corner: Corner): Focal {
  return {
    x: corner.includes("w") ? crop.x : crop.x + crop.w,
    y: corner.includes("n") ? crop.y : crop.y + crop.h,
  };
}

/** Arrow keys → a basis-point step; Shift moves ten times as far. */
function arrowDelta(event: React.KeyboardEvent): Focal | undefined {
  const step = event.shiftKey ? 1_000 : 100;
  switch (event.key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return undefined;
  }
}

const pct = (bp: number) => `${bp / 100}%`;

/**
 * The crop & focal-point tool, anchored to the picture on the canvas (the
 * audit's gap 7, the half a text patch cannot carry).
 *
 * The picture is shown whole. Clicking it marks the subject (the focal
 * point); a toggle adds a crop window with four corner handles and a
 * draggable body, locked to the chosen frame shape. Every control is a real
 * button, so the same edits work from the keyboard: arrows nudge 1%, Shift
 * 10%. A live "Result" swatch draws the placement with the very framing
 * function the page renderer uses. Apply is one edit of the block's own
 * `crop`, `focalX`/`focalY` and `aspect` props — the file is never touched.
 */
function CropFocalEditor({
  assetId,
  initial,
  x,
  y,
  labels,
  cancelLabel,
  load,
  onApply,
  onClose,
}: {
  assetId: string;
  initial: {
    crop?: ImageCrop;
    focalX?: number;
    focalY?: number;
    aspect: ImageAspect;
  };
  x: number;
  y: number;
  labels: MediaLabels;
  cancelLabel: string;
  load: (assetId: string) => Promise<CropImage | null>;
  onApply: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [image, setImage] = useState<CropImage | null | undefined>();
  const [aspect, setAspect] = useState<ImageAspect>(initial.aspect);
  const [cropOn, setCropOn] = useState(!isFullCrop(initial.crop));
  const [crop, setCrop] = useState<ImageCrop>(
    initial.crop ? clampCrop(initial.crop) : { x: 0, y: 0, w: BASIS, h: BASIS },
  );
  const [focalOverride, setFocalOverride] = useState<Focal | undefined>(
    initial.focalX !== undefined || initial.focalY !== undefined
      ? { x: initial.focalX ?? BASIS / 2, y: initial.focalY ?? BASIS / 2 }
      : undefined,
  );
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { kind: "move"; start: Focal; origin: ImageCrop }
    | { kind: "corner"; corner: Corner }
    | { kind: "focal" }
    | undefined
  >(undefined);

  useEffect(() => {
    let live = true;
    load(assetId)
      .then((result) => {
        if (live) setImage(result);
      })
      .catch(() => {
        if (live) setImage(null);
      });
    return () => {
      live = false;
    };
  }, [assetId, load]);

  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  const known = width > 0 && height > 0;
  const assetFocal: Focal = {
    x: image?.focalX ?? BASIS / 2,
    y: image?.focalY ?? BASIS / 2,
  };
  const focal: Focal = focalOverride ?? assetFocal;
  const ratio = IMAGE_ASPECTS[aspect] ?? null;

  const pointAt = (clientX: number, clientY: number): Focal => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return focal;
    return clampFocal({
      x: ((clientX - box.left) / box.width) * BASIS,
      y: ((clientY - box.top) / box.height) * BASIS,
    });
  };

  const resizeTo = (corner: Corner, point: Focal) =>
    setCrop((current) => resizeCrop(current, corner, point, width, height, ratio));

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active) return;
      const point = pointAt(event.clientX, event.clientY);
      if (active.kind === "focal") setFocalOverride(point);
      else if (active.kind === "corner") resizeTo(active.corner, point);
      else
        setCrop(
          clampCrop({
            ...active.origin,
            x: active.origin.x + point.x - active.start.x,
            y: active.origin.y + point.y - active.start.y,
          }),
        );
    };
    const up = () => {
      drag.current = undefined;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const chooseAspect = (next: ImageAspect) => {
    setAspect(next);
    const nextRatio = IMAGE_ASPECTS[next] ?? null;
    if (cropOn && nextRatio && known) setCrop(cropForAspect(width, height, nextRatio, focal));
  };

  const toggleCrop = (on: boolean) => {
    setCropOn(on);
    if (on && known) {
      setCrop(
        ratio
          ? cropForAspect(width, height, ratio, focal)
          : { x: 1_000, y: 1_000, w: 8_000, h: 8_000 },
      );
    }
  };

  const framing = known
    ? imageFraming({
        width,
        height,
        crop: cropOn ? crop : undefined,
        aspect,
        focal,
      })
    : undefined;

  const focalLabel = labels.focalPoint
    .replace("{x}", String(Math.round(focal.x / 100)))
    .replace("{y}", String(Math.round(focal.y / 100)));

  return (
    <AnchoredPopover x={x} y={y} width={360} height={560} label={labels.cropTitle} onClose={onClose}>
      <div className="grid gap-3">
        <p className="font-mono text-xs font-medium text-ink-muted">{labels.cropTitle}</p>
        {image === undefined ? (
          <p className="text-sm text-ink-muted" aria-live="polite">
            {labels.loading}
          </p>
        ) : !image || !known ? (
          <p className="text-sm text-ink-muted">{labels.unavailable}</p>
        ) : (
          <>
            <p className="text-xs text-ink-muted">{labels.focalHint}</p>
            <div
              ref={stage}
              // Image space is physical — a photograph is not mirrored in a
              // right-to-left admin — so the stage is always left-to-right
              // and its logical offsets are its physical ones.
              dir="ltr"
              data-crop-stage=""
              className="relative w-full touch-none select-none overflow-hidden rounded-md border border-rule bg-surface-muted"
              style={{ aspectRatio: `${width} / ${height}` }}
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget && !(event.target as Element).matches("img")) return;
                event.preventDefault();
                drag.current = { kind: "focal" };
                setFocalOverride(pointAt(event.clientX, event.clientY));
              }}
            >
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="block h-full w-full"
              />
              {cropOn ? (
                <>
                  {/* The discarded area, dimmed with the paper token. */}
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-paper opacity-70" style={{ height: pct(crop.y) }} />
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 bg-paper opacity-70" style={{ height: pct(BASIS - crop.y - crop.h) }} />
                  <div aria-hidden className="pointer-events-none absolute bg-paper opacity-70" style={{ top: pct(crop.y), height: pct(crop.h), insetInlineStart: 0, width: pct(crop.x) }} />
                  <div aria-hidden className="pointer-events-none absolute bg-paper opacity-70" style={{ top: pct(crop.y), height: pct(crop.h), insetInlineEnd: 0, width: pct(BASIS - crop.x - crop.w) }} />
                  <button
                    type="button"
                    data-crop-area=""
                    aria-label={labels.cropArea}
                    className="absolute cursor-move border-2 border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    style={{ insetInlineStart: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      drag.current = {
                        kind: "move",
                        start: pointAt(event.clientX, event.clientY),
                        origin: crop,
                      };
                    }}
                    onKeyDown={(event) => {
                      const delta = arrowDelta(event);
                      if (!delta) return;
                      event.preventDefault();
                      setCrop((current) =>
                        clampCrop({ ...current, x: current.x + delta.x, y: current.y + delta.y }),
                      );
                    }}
                  />
                  {CORNERS.map((corner) => {
                    const point = cornerPoint(crop, corner);
                    return (
                      <button
                        key={corner}
                        type="button"
                        data-crop-handle={corner}
                        aria-label={labels.corners[corner]}
                        className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-surface bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        style={{
                          insetInlineStart: pct(point.x),
                          top: pct(point.y),
                          cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                        }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          drag.current = { kind: "corner", corner };
                        }}
                        onKeyDown={(event) => {
                          const delta = arrowDelta(event);
                          if (!delta) return;
                          event.preventDefault();
                          resizeTo(corner, { x: point.x + delta.x, y: point.y + delta.y });
                        }}
                      />
                    );
                  })}
                </>
              ) : null}
              <button
                type="button"
                data-focal-marker=""
                aria-label={focalLabel}
                className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                style={{ insetInlineStart: pct(focal.x), top: pct(focal.y) }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  drag.current = { kind: "focal" };
                }}
                onKeyDown={(event) => {
                  const delta = arrowDelta(event);
                  if (!delta) return;
                  event.preventDefault();
                  // Functional, so key repeats faster than a render compound.
                  setFocalOverride((current) => {
                    const base = current ?? assetFocal;
                    return clampFocal({ x: base.x + delta.x, y: base.y + delta.y });
                  });
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={cropOn}
                  onChange={(event) => toggleCrop(event.target.checked)}
                />
                {labels.cropToggle}
              </label>
              <label className="ms-auto flex items-center gap-2 text-xs font-medium text-ink-muted">
                {labels.shape}
                <select
                  value={aspect}
                  onChange={(event) => chooseAspect(event.target.value as ImageAspect)}
                  className="rounded-md border border-rule bg-field px-2 py-1 text-xs text-ink"
                >
                  {(Object.keys(IMAGE_ASPECTS) as ImageAspect[]).map((value) => (
                    <option key={value} value={value}>
                      {labels.aspects[value]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-1">
              <span className="font-mono text-xs font-medium text-ink-muted">{labels.preview}</span>
              <div className="w-32 overflow-hidden rounded-md border border-rule">
                {framing && framing.mode !== "natural" ? (
                  <div data-crop-preview={framing.mode} style={{ ...framing.frame, width: "100%" }}>
                    <img src={image.src} alt="" style={framing.image} />
                  </div>
                ) : (
                  <img data-crop-preview="natural" src={image.src} alt="" className="block h-auto w-full" />
                )}
              </div>
            </div>
          </>
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            disabled={!known}
            onClick={() =>
              onApply({
                aspect,
                crop: cropOn && !isFullCrop(crop) ? clampCrop(crop) : undefined,
                focalX: focalOverride?.x,
                focalY: focalOverride?.y,
              })
            }
          >
            {labels.apply}
          </Button>
          <button
            type="button"
            onClick={() => {
              setCropOn(false);
              setCrop({ x: 0, y: 0, w: BASIS, h: BASIS });
              setAspect("original");
              setFocalOverride(undefined);
            }}
            className="rounded-md px-2.5 py-1 text-xs text-ink-muted underline decoration-rule underline-offset-2"
          >
            {labels.reset}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-xs text-ink-muted underline decoration-rule underline-offset-2"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </AnchoredPopover>
  );
}

/** Upload one picture through the library's pipeline; the Asset it became. */
async function defaultUploadImage(
  file: File,
  options: { signal: AbortSignal; onProgress: (percent: number) => void },
): Promise<{ id: string; filename: string }> {
  const result = await uploadMediaFile(file, options);
  if (!result.assetId) throw new Error("The upload did not produce a file.");
  return { id: result.assetId, filename: file.name };
}

/** The crop tool's picture: the same public resolve the renderer uses. */
async function defaultLoadImage(assetId: string): Promise<CropImage | null> {
  const response = await fetch("/api/v1/media.resolveImage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: assetId }),
    credentials: "omit",
  });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as CropImage | null;
  return data && typeof data.src === "string" ? data : null;
}

/* --------------------------------------------------------- store pickers */

/**
 * Where an anchored popover opens: logical margins, so an RTL admin's picker
 * anchors exactly where an LTR admin's does. Shared by every picker the
 * canvas raises.
 */
function popoverOrigin(x: number, y: number, width: number, height = 312) {
  const inlineStart =
    document.documentElement.dir === "rtl"
      ? Math.max(8, window.innerWidth - x - width)
      : Math.max(8, Math.min(x, Math.max(8, window.innerWidth - width - 8)));
  const blockStart = Math.max(8, Math.min(y, Math.max(8, window.innerHeight - height - 8)));
  return { marginInlineStart: inlineStart, marginBlockStart: blockStart };
}

function AnchoredPopover({
  x,
  y,
  width,
  height,
  label,
  onClose,
  children,
}: {
  x: number;
  y: number;
  width: number;
  /** Expected height, so a tall popover still opens inside the viewport. */
  height?: number;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-label={label}
        className="fixed start-0 top-0 max-h-[calc(100vh-1rem)] overflow-auto rounded-lg border border-rule bg-surface p-2 shadow-raised"
        style={{ width, ...popoverOrigin(x, y, width, height) }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Choosing the collection a store section reads from, raised from the
 * section's swap affordance on the canvas. Choices load when the picker
 * opens; a pick is a structural canvas edit — it saves at once so the
 * canvas's invisible reload shows the new shelf without waiting out the
 * debounce.
 */
function CollectionPicker({
  load,
  current,
  x,
  y,
  label,
  emptyLabel,
  cancelLabel,
  onPick,
  onClose,
}: {
  load: () => Promise<StoreChoice[]>;
  current: string;
  x: number;
  y: number;
  label: string;
  emptyLabel: string;
  cancelLabel: string;
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<StoreChoice[] | undefined>();
  useEffect(() => {
    let active = true;
    load()
      .then((rows) => {
        if (active) setChoices(rows);
      })
      .catch(() => {
        if (active) setChoices([]);
      });
    return () => {
      active = false;
    };
  }, [load]);
  return (
    <AnchoredPopover x={x} y={y} width={288} label={label} onClose={onClose}>
      {choices === undefined ? (
        <p className="px-2 py-1.5 text-sm text-ink-muted">…</p>
      ) : choices.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="grid max-h-64 list-none gap-1 overflow-auto p-0">
          {choices.map((choice, index) => (
            <li key={choice.slug}>
              <button
                type="button"
                autoFocus={index === 0}
                aria-current={choice.slug === current ? "true" : undefined}
                onClick={() => onPick(choice.slug)}
                className={cx(
                  "w-full truncate rounded-md px-2.5 py-1.5 text-start text-sm hover:bg-surface-muted focus-visible:bg-surface-muted",
                  choice.slug === current ? "font-semibold text-accent" : "text-ink",
                )}
              >
                {choice.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1 border-t border-rule pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2.5 py-1 text-xs text-ink-muted underline decoration-rule underline-offset-2"
        >
          {cancelLabel}
        </button>
      </div>
    </AnchoredPopover>
  );
}

/**
 * Picking the products a product row shows, in the owner's order, raised
 * from the row's pick affordance. Multi-select against the live product
 * list; the pick replaces the row's `products` prop as one structural edit.
 */
function ProductPicker({
  load,
  current,
  x,
  y,
  label,
  doneLabel,
  pickedLabel,
  emptyLabel,
  cancelLabel,
  onPick,
  onClose,
}: {
  load: () => Promise<StoreChoice[]>;
  /** Comma-separated slugs the row currently holds. */
  current: string;
  x: number;
  y: number;
  label: string;
  doneLabel: string;
  pickedLabel: string;
  emptyLabel: string;
  cancelLabel: string;
  onPick: (slugs: string[]) => void;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<StoreChoice[] | undefined>();
  const [picked, setPicked] = useState<string[]>(() =>
    current.split(",").map((slug) => slug.trim()).filter(Boolean),
  );
  useEffect(() => {
    let active = true;
    load()
      .then((rows) => {
        if (active) setChoices(rows);
      })
      .catch(() => {
        if (active) setChoices([]);
      });
    return () => {
      active = false;
    };
  }, [load]);
  const toggle = (slug: string) =>
    setPicked((rows) =>
      rows.includes(slug) ? rows.filter((row) => row !== slug) : [...rows, slug],
    );
  return (
    <AnchoredPopover x={x} y={y} width={320} label={label} onClose={onClose}>
      <p className="px-2 py-1 text-xs text-ink-muted">
        {pickedLabel.replace("{count}", String(picked.length))}
      </p>
      {choices === undefined ? (
        <p className="px-2 py-1.5 text-sm text-ink-muted">…</p>
      ) : choices.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="grid max-h-64 list-none gap-1 overflow-auto p-0">
          {choices.map((choice) => (
            <li key={choice.slug}>
              <label
                className={cx(
                  "flex cursor-pointer items-baseline gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-muted",
                  picked.includes(choice.slug) ? "text-ink" : "text-ink-muted",
                )}
              >
                <input
                  type="checkbox"
                  checked={picked.includes(choice.slug)}
                  onChange={() => toggle(choice.slug)}
                  className="shrink-0"
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{choice.title}</span>
                  {choice.detail ? (
                    <span className="block truncate text-xs text-ink-muted">
                      {choice.detail}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-2 border-t border-rule pt-2">
        <Button type="button" onClick={() => onPick(picked)} disabled={!choices}>
          {doneLabel}
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2.5 py-1 text-xs text-ink-muted underline decoration-rule underline-offset-2"
        >
          {cancelLabel}
        </button>
      </div>
    </AnchoredPopover>
  );
}

/**
 * Editing an image's alt text where the image renders (the audit's gap 7,
 * the half a text patch can carry): a small anchored field seeded with the
 * alt the picture currently shows. The apply is an ordinary canvas edit of
 * the block's own `alt` override.
 */
function AltEditor({
  initial,
  x,
  y,
  label,
  applyLabel,
  cancelLabel,
  onApply,
  onClose,
}: {
  initial: string;
  x: number;
  y: number;
  label: string;
  applyLabel: string;
  cancelLabel: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AnchoredPopover x={x} y={y} width={288} label={label} onClose={onClose}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(value);
        }}
      >
        <label className="grid gap-1">
          <span className="font-mono text-xs font-medium text-ink-muted">{label}</span>
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit">
            {applyLabel}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-xs text-ink-muted underline decoration-rule underline-offset-2"
          >
            {cancelLabel}
          </button>
        </div>
      </form>
    </AnchoredPopover>
  );
}
