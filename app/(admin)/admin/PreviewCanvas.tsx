// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
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
import { useEffect, useRef, useState } from "react";
import { DeviceMobile, Desktop } from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";

export interface PreviewLabels {
  region: string;
  desktop: string;
  mobile: string;
}

export function PreviewCanvas({
  src,
  version,
  selectedId,
  onSelect,
  onEdit,
  labels,
}: {
  /** The preview page for this subject. */
  src: string;
  /**
   * Bumped by the editor after every successful save, which is what reloads
   * the frame. The canvas shows what is *stored* — so it can never disagree
   * with the page, and the only lag is the autosave debounce.
   */
  version: number;
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
  labels: PreviewLabels;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  // Clicks in the frame select a block in the editor.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        blockId?: string | null;
        edit?: { blockId?: string; prop?: string; value?: string };
      };
      if (data?.source !== "freeholder-preview") return;
      if (data.edit?.blockId && data.edit.prop !== undefined) {
        onEdit(data.edit.blockId, data.edit.prop, data.edit.value ?? "");
        return;
      }
      onSelect(data.blockId ?? undefined);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onSelect, onEdit]);

  // …and selecting in the editor outlines it in the frame.
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { source: "freeholder-editor", blockId: selectedId ?? null },
      window.location.origin,
    );
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
