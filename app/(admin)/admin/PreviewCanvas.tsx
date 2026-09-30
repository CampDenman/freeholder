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
// the typeable elements from the tree side in the same commit as each change,
// so a keystroke's preview never waits for the debounced autosave or a server
// round-trip. Everything a text patch cannot express (a new block, a heading
// level, a swapped collection) still reconverges when a save bumps `version`
// and the frame reloads from stored state — and since the audit's gap 5 that
// reload is *invisible*: the next version loads in a hidden second frame and
// only swaps in when it has finished rendering, so the owner never watches the
// canvas blank, flicker or jump.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeviceMobile, Desktop } from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";

export interface PreviewLabels {
  region: string;
  desktop: string;
  mobile: string;
  /** The image block's on-canvas replace affordance, and the picker's name. */
  replaceImage: string;
  /** Placeholder an image block with no asset chosen renders on the canvas. */
  noImage: string;
  /** Picker hint when the asset library holds no images at all. */
  noAssets: string;
  /** The collection blocks' on-canvas replace affordance, and the picker's name. */
  replaceCollection: string;
  /** Placeholder a collection block with no collection chosen renders. */
  noCollection: string;
  /** Picker hint when no published collection exists yet. */
  noCollections: string;
  /** The product blocks' on-canvas replace affordance, and the picker's name. */
  replaceProduct: string;
  /** Placeholder a product block with no product chosen renders. */
  noProduct: string;
  /** Picker hint when no active product exists yet. */
  noProducts: string;
}

/** A node of the editor's local draft — the same shape it persists. */
export interface PreviewDraftNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: PreviewDraftNode[];
}

/**
 * An anchored editing affordance raised from the frame (asset swap, collection
 * swap, product pick, alt text). `anchor` is the host's position in this
 * document's viewport — the frame's physical coordinates plus the frame's own
 * offset — so the editor can attach its popover next to whatever raised it.
 */
export interface FrameAnchor {
  x: number;
  y: number;
}

export function PreviewCanvas({
  src,
  version,
  draft,
  selectedId,
  onSelect,
  onEdit,
  onMove,
  onAssetPick,
  onPropPick,
  onCollectionPick,
  onProductPick,
  onAltEdit,
  onCropEdit,
  outlines = false,
  heightMode = "fixed",
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
   * The editor's local draft tree. Broadcast to the frame in the same commit
   * as every change, without waiting for the debounced autosave — this is
   * what makes keystroke → preview a local hop.
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
  onEdit: (blockId: string, prop: string, value: unknown) => void;
  /**
   * A block dragged somewhere else. The canvas has already moved the DOM for
   * feedback, but that is a preview of the request — the editor decides
   * whether the move is legal and what the tree becomes.
   */
  onMove: (blockId: string, targetId: string, position: string) => void;
  /**
   * The replace affordance on an image block was clicked. `anchor` is the
   * host element's position in this document's viewport (physical x/y, from
   * getBoundingClientRect), for anchoring the asset picker next to the image
   * it will change.
   */
  onAssetPick?: (
    blockId: string,
    prop: string,
    anchor: FrameAnchor,
  ) => void;
  /**
   * The replace affordance on a commerce block (collection or product pick)
   * was clicked — same anchored-picker contract as `onAssetPick`, raised for
   * entity props the media picker cannot offer.
   */
  onPropPick?: (
    blockId: string,
    prop: string,
    anchor: { x: number; y: number },
  ) => void;
  /** A store section's collection-swap affordance was clicked. */
  onCollectionPick?: (
    blockId: string,
    prop: string,
    current: string,
    anchor: FrameAnchor,
  ) => void;
  /** A product row's pick affordance was clicked. */
  onProductPick?: (
    blockId: string,
    prop: string,
    current: string,
    anchor: FrameAnchor,
  ) => void;
  /** An image block's alt-text affordance was clicked. */
  onAltEdit?: (
    blockId: string,
    prop: string,
    current: string,
    anchor: FrameAnchor,
  ) => void;
  /** An image block's crop & focal affordance was clicked (C2.25). */
  onCropEdit?: (blockId: string, prop: string, anchor: FrameAnchor) => void;
  /** Persistent block outlines (the zen surface's show-structure toggle). */
  outlines?: boolean;
  /**
   * `fixed` keeps the classic 32rem editing window; `auto` sizes the frame to
   * the page's true rendered height, which the frame reports after every
   * change — the zen surface's full-page view (audit gap 10).
   */
  heightMode?: "fixed" | "auto";
  labels: PreviewLabels;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  /**
   * The invisible-reload pair. `urls` holds each slot's address (one slot may
   * be empty); `live` is the slot the owner sees. A save puts the new version
   * into the idle slot, hidden; when it finishes loading it becomes `live`
   * and the previously live slot goes idle, ready to host the next version.
   */
  const initialUrl = `${src}?v=${version}`;
  const [urls, setUrls] = useState<[string, string | undefined]>([initialUrl, undefined]);
  const [live, setLive] = useState<0 | 1>(0);
  const [frameHeight, setFrameHeight] = useState<number | undefined>();
  const slot0 = useRef<HTMLIFrameElement>(null);
  const slot1 = useRef<HTMLIFrameElement>(null);
  const slots = [slot0, slot1] as const;
  /** The newest version's URL — a finishing slot swaps in only if it holds it. */
  const wantedRef = useRef(initialUrl);
  /** Latest slot URLs and preferences, readable by the message handler. */
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const outlinesRef = useRef(outlines);
  outlinesRef.current = outlines;
  /** Latest draft, readable by the ready handshake between renders. */
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Scroll position carried across an invisible swap. */
  const pendingScrollRef = useRef(0);

  const frameOf = (slot: 0 | 1) => slots[slot].current;
  const liveFrame = () => frameOf(live);

  const postToFrame = (message: Record<string, unknown>) => {
    liveFrame()?.contentWindow?.postMessage(message, window.location.origin);
  };

  // A save (or the first load) names the version the canvas should show. The
  // idle slot takes it; the visible slot keeps the old render until the new
  // one has actually loaded.
  useEffect(() => {
    const url = `${src}?v=${version}`;
    wantedRef.current = url;
    setUrls((current) => {
      if (current[live] === url || current[live === 0 ? 1 : 0] === url) return current;
      const next: [string, string | undefined] = [...current];
      next[live === 0 ? 1 : 0] = url;
      return next;
    });
  }, [src, version, live]);

  function onSlotLoad(slot: 0 | 1) {
    const url = urlsRef.current[slot];
    if (!url || url !== wantedRef.current || slot === live) return;
    // Capture the scroll before the swap so the new render opens where the
    // owner was reading; a same-origin frame always answers scrollY.
    try {
      pendingScrollRef.current = liveFrame()?.contentWindow?.scrollY ?? 0;
    } catch {
      pendingScrollRef.current = 0;
    }
    setLive(slot);
  }

  // After a swap: carry the scroll over, re-assert the selection outline and
  // re-broadcast the draft (the new frame asked for it with its `ready`, but
  // it asked while it was still hidden and the editor only answers the live
  // frame). `live` is the only dependency by design: the messages re-assert
  // current state, and selectedId/draft changes re-post through their own
  // effects below.
  useEffect(() => {
    const frame = liveFrame();
    if (!frame) return;
    try {
      frame.contentWindow?.scrollTo(0, pendingScrollRef.current);
    } catch {
      // Same-origin by construction; a defensive no-op costs nothing.
    }
    frame.contentWindow?.postMessage(
      { source: "freeholder-editor", blockId: selectedId ?? null },
      window.location.origin,
    );
    if (draftRef.current) {
      frame.contentWindow?.postMessage(
        { source: "freeholder-editor", draft: draftRef.current, outlines },
        window.location.origin,
      );
    }
  }, [live]);

  // The draft follows the tree in the same commit that changed it: a layout
  // effect queues the message before the browser next yields, so the frame
  // receives it within a task of the keystroke that produced it. Nothing is
  // deferred to an animation frame — React already coalesces a burst of
  // changes into one commit (so one broadcast per render, not per echo), and
  // the frame's textContent writes are plain DOM the browser paints once per
  // frame regardless. Against the §15.1 harness an rAF deferral here measured
  // a frame of extra keystroke→preview latency; the layout effect sits at the
  // same-task floor.
  useLayoutEffect(() => {
    if (!draft) return;
    postToFrame({ source: "freeholder-editor", draft: draftRef.current, outlines });
  }, [draft, outlines]);

  // Clicks and edits in the frame select blocks and apply picks in the editor.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      // Only the live frame speaks: the hidden staging slot loads the same
      // scripts and posts the same ready/height messages, and answering them
      // would leak its transient state into the editor. A null source is
      // also accepted — synthetic MessageEvents (the unit suite) carry none,
      // and every real frame speaks with its own window's identity.
      const liveWindow = frameOf(live)?.contentWindow;
      if (
        liveWindow &&
        event.source !== null &&
        event.source !== liveWindow &&
        event.source !== window
      ) return;
      const post = (message: Record<string, unknown>) => {
        frameOf(live)?.contentWindow?.postMessage(message, window.location.origin);
      };
      const anchor = (x?: number, y?: number) => {
        const frameBox = frameOf(live)?.getBoundingClientRect();
        return {
          x: (frameBox?.left ?? 0) + (x ?? 0),
          y: (frameBox?.top ?? 0) + (y ?? 0),
        };
      };
      const data = event.data as {
        source?: string;
        blockId?: string | null;
        ready?: boolean;
        height?: number;
        edit?: { blockId?: string; prop?: string; value?: unknown };
        move?: { blockId?: string; targetId?: string; position?: string };
        assetPick?: { prop?: string; x?: number; y?: number };
        pick?: { prop?: string; x?: number; y?: number };
        collectionPick?: {
          prop?: string;
          current?: string;
          x?: number;
          y?: number;
        };
        productPick?: { prop?: string; current?: string; x?: number; y?: number };
        altEdit?: { prop?: string; current?: string; x?: number; y?: number };
        cropEdit?: { prop?: string; x?: number; y?: number };
      };
      if (data?.source !== "freeholder-preview") return;
      // The frame (re)loaded — a reload may have raced the last broadcast, so
      // send the current draft again; it is a no-op when already in step.
      if (data.ready) {
        if (draftRef.current) {
          post({ source: "freeholder-editor", draft: draftRef.current, outlines: outlinesRef.current });
        }
        return;
      }
      if (typeof data.height === "number") {
        setFrameHeight(data.height);
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
      if (data.assetPick?.prop && data.blockId && onAssetPick) {
        onAssetPick(data.blockId, data.assetPick.prop, anchor(data.assetPick.x, data.assetPick.y));
        return;
      }
      if (data.collectionPick?.prop && data.blockId && onCollectionPick) {
        onCollectionPick(
          data.blockId,
          data.collectionPick.prop,
          data.collectionPick.current ?? "",
          anchor(data.collectionPick.x, data.collectionPick.y),
        );
        return;
      }
      if (data.productPick?.prop && data.blockId && onProductPick) {
        onProductPick(data.blockId, data.productPick.prop, data.productPick.current ?? "", {
          ...anchor(data.productPick.x, data.productPick.y),
        });
        return;
      }
      if (data.altEdit?.prop && data.blockId && onAltEdit) {
        onAltEdit(data.blockId, data.altEdit.prop, data.altEdit.current ?? "", {
          ...anchor(data.altEdit.x, data.altEdit.y),
        });
        return;
      }
      if (data.cropEdit?.prop && data.blockId && onCropEdit) {
        onCropEdit(data.blockId, data.cropEdit.prop, anchor(data.cropEdit.x, data.cropEdit.y));
        return;
      }
      if (data.pick?.prop && data.blockId && onPropPick) {
        onPropPick(data.blockId, data.pick.prop, anchor(data.pick.x, data.pick.y));
      }
      onSelect(data.blockId ?? undefined);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onSelect, onEdit, onMove, onAssetPick, onPropPick, onCollectionPick, onProductPick, onAltEdit, onCropEdit, live]);

  // …and selecting in the editor outlines it in the frame.
  useEffect(() => {
    postToFrame({ source: "freeholder-editor", blockId: selectedId ?? null });
  }, [selectedId, live]);

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
        {([0, 1] as const).map((slot) =>
          urls[slot] === undefined ? null : (
            <iframe
              key={slot}
              ref={slots[slot]}
              title={slot === live ? labels.region : ""}
              aria-hidden={slot === live ? undefined : true}
              tabIndex={slot === live ? undefined : -1}
              src={urls[slot]}
              onLoad={() => onSlotLoad(slot)}
              className={cx(
                "block border-0 bg-paper transition-all",
                device === "mobile" ? "mx-auto w-[24rem]" : "w-full",
                slot !== live && "hidden",
                heightMode === "fixed" && "h-[32rem]",
              )}
              style={
                heightMode === "auto" && slot === live && frameHeight
                  ? { height: frameHeight }
                  : undefined
              }
            />
          ),
        )}
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
