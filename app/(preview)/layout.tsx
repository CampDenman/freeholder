// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The editor canvas's shell (MASTER.md §32: "live responsive preview").
//
// Its own route group so the frame gets a bare document — no admin nav, no
// site chrome — while still inheriting the root layout's design tokens and
// theme attribute. The owner is editing the page, not the frame around it.
//
// Rendering the real blocks through the real `renderBlocks` is the whole point.
// A second "editor rendering" is how every page builder eventually shows you
// something you do not get; here the canvas and the public page are the same
// function, and only a flag differs.
//
// The frame renders the *stored* tree; `canvas-bridge.ts` layers the editor's
// local draft onto the typeable elements so a keystroke's preview does not
// wait for the autosave debounce, and a save still reloads the frame from
// stored state.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { CSP_NONCE_HEADER } from "@/core/http/csp";
import { serializeInlineJson } from "@/core/http/inline-json";
import { getT } from "../i18n";
import { CANVAS_BRIDGE, CANVAS_DRAG } from "./canvas-bridge";

export const dynamic = "force-dynamic";

/** Authenticated view of unpublished content, so it is never indexable. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Selection affordances exist only here, never on the real page. */
const CANVAS_CSS = `
  .fh-canvas { display: grid; gap: 2rem; max-width: 48rem; margin: 0 auto; padding: 2.5rem 1.5rem 2.5rem 3rem; }
  [data-block-id] { outline-offset: 3px; cursor: pointer; }
  [data-editable-prop] { cursor: text; }
  [data-editable-prop]:focus { outline: 2px solid var(--fh-accent); outline-offset: 2px; }
  [data-editable-rich] { cursor: text; white-space: normal; }
  [data-editable-rich]:focus { outline: 2px solid var(--fh-accent); outline-offset: 2px; }
  [data-hovered] { outline: 1px dashed var(--fh-rule); }
  [data-selected] { outline: 2px solid var(--fh-accent); }
  [data-block-id] { position: relative; }
  .fh-grip {
    position: absolute; inset-inline-start: -2rem; inset-block-start: 0;
    width: 1.25rem; height: 1.25rem;
    display: flex; align-items: center; justify-content: center;
    cursor: grab; border-radius: 0.25rem; appearance: none; padding: 0;
    background: var(--fh-surface); border: 1px solid var(--fh-rule-strong);
    font-size: 0.75rem; line-height: 1; font-family: inherit; user-select: none;
    /* Always rendered: a hidden control can never take focus, which would
       make the keyboard path unreachable, and the persistent handle is also
       how a first-timer sees where the blocks are. Full-strength ink keeps
       it inside the WCAG AA contrast budget in both themes; hover and focus
       sharpen the chrome around it. */
    color: var(--fh-ink);
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  [data-hovered] > .fh-grip, [data-selected] > .fh-grip,
  [data-block-id]:focus-within > .fh-grip {
    border-color: var(--fh-accent);
    box-shadow: var(--fh-shadow-sm);
  }
  .fh-grip:focus-visible { outline: 2px solid var(--fh-focus); outline-offset: 2px; }
  [data-dragging] { opacity: 0.4; }
  [data-drop="before"]::before, [data-drop="after"]::after {
    content: ""; position: absolute; inset-inline: 0; height: 3px;
    background: var(--fh-accent); border-radius: 2px;
  }
  [data-drop="before"]::before { inset-block-start: -0.625rem; }
  [data-drop="after"]::after { inset-block-end: -0.625rem; }
  [data-drop="inside"] {
    outline: 2px dashed var(--fh-accent);
    outline-offset: 4px;
    background: var(--fh-accent-soft);
  }

  /* The drag ghost: the dragged block's own render, lifted translucent. The
     browser paints it as the drag image, offset so it sits under the
     pointer where the block was grabbed; it lives far off-screen in the
     document and is removed at dragend. */
  .fh-ghost {
    position: fixed; inset-inline-start: -10000px; inset-block-start: -10000px;
    z-index: -1; pointer-events: none; overflow: hidden;
    opacity: 0.92; border: 1px solid var(--fh-accent); border-radius: 0.5rem;
    background: var(--fh-surface); box-shadow: var(--fh-shadow-raised);
    padding: 0.5rem;
  }

  /* The move announcer for screen readers: status role, visually hidden,
     present in the frame because that is where grip focus lives. */
  .fh-sr-only {
    position: absolute; width: 1px; height: 1px; overflow: hidden;
    clip-path: inset(50%); white-space: nowrap;
  }

  /* The image block's on-canvas replace affordance. Token colours so both
     themes render it correctly; keyboard focus reveals it without a hover. */
  .fh-asset { position: relative; }
  .fh-asset-empty {
    display: flex; align-items: center; justify-content: center;
    min-height: 9rem; border: 1px dashed var(--fh-rule); border-radius: 0.5rem;
    color: var(--fh-ink-muted); font-size: 0.875rem;
  }
  .fh-replace {
    position: absolute; inset-block-start: 0.5rem; inset-inline-end: 0.5rem;
    padding: 0.3rem 0.65rem; border-radius: 0.375rem;
    border: 1px solid var(--fh-rule); background: var(--fh-surface);
    color: var(--fh-ink); font-size: 0.75rem; font-weight: 600;
    cursor: pointer; opacity: 0; transition: opacity 0.12s ease;
  }
  .fh-asset:hover .fh-replace, .fh-asset:focus-within .fh-replace,
  .fh-replace:focus { opacity: 1; }
  .fh-replace:focus-visible { outline: 2px solid var(--fh-accent); outline-offset: 2px; }

`;

export default async function PreviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [t, requestHeaders] = await Promise.all([getT(), headers()]);
  const nonce = requestHeaders.get(CSP_NONCE_HEADER) ?? undefined;
  // The grip's tooltip and the move announcements are copy, so they come from
  // the catalog like the rest — injected as constants the scripts read
  // rather than hardcoded in them.
  const dragLabel = serializeInlineJson(t("cms.editor.dragBlock"));
  const announceUp = serializeInlineJson(t("cms.editor.announceMoveUp"));
  const announceDown = serializeInlineJson(t("cms.editor.announceMoveDown"));
  const announceMove = serializeInlineJson(t("cms.editor.announceMove"));
  return (
    <>
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: CANVAS_CSS }} />
      <div className="fh-canvas">{children}</div>
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html:
            `var FH_DRAG_LABEL = ${dragLabel};` +
            `var FH_ANNOUNCE_UP = ${announceUp};` +
            `var FH_ANNOUNCE_DOWN = ${announceDown};` +
            `var FH_ANNOUNCE_MOVE = ${announceMove};` +
            CANVAS_BRIDGE +
            CANVAS_DRAG,
        }}
      />
    </>
  );
}
