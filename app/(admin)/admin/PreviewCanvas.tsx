// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The live canvas beside the controls (MASTER.md §32: "live responsive
// preview (desktop/mobile)").
//
// An iframe rather than rendering blocks inline, for one reason that decides
// it: the blocks are server components. Rendering them in the browser would
// mean a second implementation, and a second implementation is how a page
// builder starts showing you something you do not actually get. The frame
// asks the server to render the tree with the same function the public page
// uses.
//
// It is a *view*. Edits flow tree → canvas, never canvas → tree. The moment
// the DOM becomes the source of truth, typed blocks, migrations and re-theming
// all stop being true (§32).
//
// The frame renders stored state; the editor's local draft is layered onto
// the typeable elements from the tree side, rAF-throttled, so a keystroke's
// preview never waits for the debounced autosave or a server round-trip.
// Everything a text patch cannot express (a new block, a heading level) still
// reconverges when a save bumps `version` and the frame reloads from stored
// state.
import { useEffect, useRef, useState } from "react";
import { DeviceMobile, Desktop } from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";

export interface PreviewLabels {
  region: string;
  desktop: string;
  mobile: string;
}

/** A node of the editor's local draft — the same shape it persists. */
export interface PreviewDraftNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: PreviewDraftNode[];
}

export function PreviewCanvas({
  src,
  version,
  draft,
  selectedId,
  onSelect,
  onEdit,
  onMove,
  labels,
}: {
  /** The preview page for this subject. */
  src: string;
  /**
   * Bumped by the editor after every successful save, which is what reloads
   * the frame from stored state. Between saves, the local draft (below)
   * keeps the canvas in step keystroke by keystroke.
   */
  version: number;
  /**
   * The editor's local draft tree. Broadcast to the frame on the next
   * animation frame after every change, without waiting for the debounced
   * autosave — this is what makes keystroke → preview a local hop.
   */
  draft?: PreviewDraftNode[];
  selectedId?: string;
  onSelect: (blockId: string | undefined) => void;
  /**
   * Text typed directly on the canvas.
   *
   * The canvas reports; the editor decides. It never writes to the tree
   * itself, which is what keeps the tree the source of truth and the rendering
   * a view of it.
   */
  onEdit: (blockId: string, prop: string, value: string) => void;
  /**
   * A block dragged somewhere else. The canvas has already moved the DOM for
   * feedback, but that is a preview of the request — the editor decides
   * whether the move is legal and what the tree becomes.
   */
  onMove: (blockId: string, targetId: string, position: string) => void;
  labels: PreviewLabels;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  /** Latest draft, readable by the rAF callback and the ready handshake. */
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const postToFrame = (message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  };

  // The draft follows the tree on the next animation frame: one broadcast per
  // frame at most, no matter how many props a burst of typing changed. The
  // frame layers it onto its typeable elements; the save/reload cycle stays
  // the arbiter of everything structural.
  useEffect(() => {
    if (!draft) return;
    const raf = requestAnimationFrame(() => {
      postToFrame({ source: "freeholder-editor", draft: draftRef.current });
    });
    return () => cancelAnimationFrame(raf);
  }, [draft]);

  // Clicks in the frame select a block in the editor.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        blockId?: string | null;
        ready?: boolean;
        edit?: { blockId?: string; prop?: string; value?: string };
        move?: { blockId?: string; targetId?: string; position?: string };
      };
      if (data?.source !== "freeholder-preview") return;
      // The frame (re)loaded — a reload may have raced the last broadcast, so
      // send the current draft again; it is a no-op when already in step.
      if (data.ready) {
        if (draftRef.current) {
          postToFrame({ source: "freeholder-editor", draft: draftRef.current });
        }
        return;
      }
      if (data.edit?.blockId && data.edit.prop !== undefined) {
        onEdit(data.edit.blockId, data.edit.prop, data.edit.value ?? "");
        return;
      }
      if (data.move?.blockId && data.move.targetId && data.move.position) {
        onMove(data.move.blockId, data.move.targetId, data.move.position);
        return;
      }
      onSelect(data.blockId ?? undefined);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onSelect, onEdit, onMove]);

  // …and selecting in the editor outlines it in the frame.
  useEffect(() => {
    postToFrame({ source: "freeholder-editor", blockId: selectedId ?? null });
  }, [selectedId, version]);

  return (
    <section aria-label={labels.region} className="grid gap-2">
      <div className="flex items-center gap-1">
        <DeviceButton
          active={device === "desktop"}
          label={labels.desktop}
          onClick={() => setDevice("desktop")}
        >
          <Desktop size={14} weight="bold" />
        </DeviceButton>
        <DeviceButton
          active={device === "mobile"}
          label={labels.mobile}
          onClick={() => setDevice("mobile")}
        >
          <DeviceMobile size={14} weight="bold" />
        </DeviceButton>
      </div>

      <div className="overflow-hidden rounded-lg border border-rule bg-surface">
        <iframe
          ref={frame}
          title={labels.region}
          // The version is in the URL, so a save reloads the frame rather than
          // the component reaching into it.
          src={`${src}?v=${version}`}
          className={cx(
            "block h-[32rem] border-0 bg-paper transition-all",
            device === "mobile" ? "mx-auto w-[24rem]" : "w-full",
          )}
        />
      </div>
    </section>
  );
}

function DeviceButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1.5 text-xs font-medium",
        active ? "bg-accent text-on-accent" : "text-ink-muted",
      )}
    >
      {children}
      {label}
    </button>
  );
}
