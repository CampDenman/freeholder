// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
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
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getT } from "../i18n";

export const dynamic = "force-dynamic";

/** Authenticated view of unpublished content, so it is never indexable. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Reports clicks to the editor and highlights whatever the editor selects.
 *
 * Links are neutralised: following one would navigate the frame away from the
 * page being edited, which reads as the editor breaking.
 */
const BRIDGE = `
document.addEventListener("click", function (event) {
  var target = event.target instanceof Element ? event.target : null;
  if (target && target.closest("a")) event.preventDefault();
  var el = target ? target.closest("[data-block-id]") : null;
  parent.postMessage({
    source: "freeholder-preview",
    blockId: el ? el.getAttribute("data-block-id") : null
  }, window.location.origin);
});
document.addEventListener("mouseover", function (event) {
  var target = event.target instanceof Element ? event.target : null;
  var el = target ? target.closest("[data-block-id]") : null;
  document.querySelectorAll("[data-hovered]").forEach(function (n) {
    n.removeAttribute("data-hovered");
  });
  if (el) el.setAttribute("data-hovered", "true");
});
// Typing on the canvas. The element carries which prop it shows and the block
// it belongs to; the editor owns the tree and decides what to do with it.
//
// Listens on input rather than blur, so the controls stay in step while
// typing. The canvas never writes to the tree itself; it only reports what was
// typed, and the editor debounces before saving.
document.addEventListener("input", function (event) {
  var el = event.target instanceof Element ? event.target : null;
  if (!el || !el.hasAttribute("data-editable-prop")) return;
  var block = el.closest("[data-block-id]");
  if (!block) return;
  parent.postMessage({
    source: "freeholder-preview",
    edit: {
      blockId: block.getAttribute("data-block-id"),
      prop: el.getAttribute("data-editable-prop"),
      value: el.innerText
    }
  }, window.location.origin);
});

// Enter would insert a line break inside a heading; blur commits instead.
document.addEventListener("keydown", function (event) {
  var el = event.target instanceof Element ? event.target : null;
  if (!el || !el.hasAttribute("data-editable-prop")) return;
  if (event.key === "Enter" && el.tagName !== "DIV") {
    event.preventDefault();
    el.blur();
  }
});

window.addEventListener("message", function (event) {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.source !== "freeholder-editor") return;
  document.querySelectorAll("[data-selected]").forEach(function (n) {
    n.removeAttribute("data-selected");
  });
  if (!event.data.blockId) return;
  var el = document.querySelector('[data-block-id="' + event.data.blockId + '"]');
  if (el) {
    el.setAttribute("data-selected", "true");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
});
`;

const DRAG = `
// ── Dragging blocks around the canvas ─────────────────────────────────────
//
// A grip rather than making the whole block draggable: a draggable element
// swallows text selection, and half these blocks are typed into. The grip is
// injected here rather than emitted by the renderer, so the block components
// stay free of editor furniture.
//
// The DOM is moved on drop for immediate feedback, but that move is a
// *preview of the reported intent*, not the change itself. The tree is the
// source of truth; the editor applies the move to it and the next render
// overwrites whatever this did. If the editor refuses the move — dropping a
// container into its own child — the canvas simply snaps back on that render.
function fhAddGrips() {
  document.querySelectorAll("[data-block-id]").forEach(function (block) {
    if (block.querySelector(":scope > .fh-grip")) return;
    var grip = document.createElement("span");
    grip.className = "fh-grip";
    grip.setAttribute("draggable", "true");
    grip.setAttribute("aria-hidden", "true");
    grip.title = FH_DRAG_LABEL;
    grip.textContent = "⠿";
    block.appendChild(grip);
  });
}
fhAddGrips();
new MutationObserver(fhAddGrips).observe(document.body, {
  childList: true,
  subtree: true
});

var fhDragId = null;
var fhDrop = null;

function fhClearIndicator() {
  document.querySelectorAll("[data-drop]").forEach(function (n) {
    n.removeAttribute("data-drop");
  });
}

document.addEventListener("dragstart", function (event) {
  var target = event.target instanceof Element ? event.target : null;
  if (!target || !target.classList.contains("fh-grip")) return;
  var block = target.closest("[data-block-id]");
  if (!block) return;
  fhDragId = block.getAttribute("data-block-id");
  block.setAttribute("data-dragging", "true");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag without data on the transfer.
    event.dataTransfer.setData("text/plain", fhDragId);
  }
});

document.addEventListener("dragover", function (event) {
  if (!fhDragId) return;
  event.preventDefault();
  var target = event.target instanceof Element ? event.target : null;
  var block = target ? target.closest("[data-block-id]") : null;
  fhClearIndicator();
  if (!block) { fhDrop = null; return; }

  var id = block.getAttribute("data-block-id");
  if (id === fhDragId) { fhDrop = null; return; }

  var box = block.getBoundingClientRect();
  var container = block.querySelector(":scope > * > [data-block-id]") !== null
    || block.hasAttribute("data-container");
  var empty = container && block.querySelector("[data-block-id]") === null;

  var position;
  if (empty) {
    position = "inside";
  } else {
    position = event.clientY < box.top + box.height / 2 ? "before" : "after";
  }
  block.setAttribute("data-drop", position);
  fhDrop = { targetId: id, position: position };
});

document.addEventListener("drop", function (event) {
  if (!fhDragId || !fhDrop) return;
  event.preventDefault();
  parent.postMessage({
    source: "freeholder-preview",
    move: {
      blockId: fhDragId,
      targetId: fhDrop.targetId,
      position: fhDrop.position
    }
  }, window.location.origin);

  // Optimistic, and only that: the editor decides what really happened.
  var moving = document.querySelector('[data-block-id="' + fhDragId + '"]');
  var target = document.querySelector('[data-block-id="' + fhDrop.targetId + '"]');
  if (moving && target && !target.contains(moving)) {
    if (fhDrop.position === "before") {
      target.parentNode.insertBefore(moving, target);
    } else if (fhDrop.position === "after") {
      target.parentNode.insertBefore(moving, target.nextSibling);
    } else {
      target.appendChild(moving);
    }
  }
});

document.addEventListener("dragend", function () {
  fhDragId = null;
  fhDrop = null;
  fhClearIndicator();
  document.querySelectorAll("[data-dragging]").forEach(function (n) {
    n.removeAttribute("data-dragging");
  });
});
`;

/** Selection affordances exist only here, never on the real page. */
const CANVAS_CSS = `
  .fh-canvas { display: grid; gap: 2rem; max-width: 48rem; margin: 0 auto; padding: 2.5rem 1.5rem 2.5rem 3rem; }
  [data-block-id] { outline-offset: 3px; cursor: pointer; }
  [data-editable-prop] { cursor: text; }
  [data-editable-prop]:focus { outline: 2px solid var(--fh-accent); outline-offset: 2px; }
  [data-hovered] { outline: 1px dashed var(--fh-rule); }
  [data-selected] { outline: 2px solid var(--fh-accent); }
  [data-block-id] { position: relative; }
  .fh-grip {
    position: absolute; inset-inline-start: -2rem; inset-block-start: 0;
    width: 1.25rem; height: 1.25rem; display: none;
    align-items: center; justify-content: center;
    cursor: grab; border-radius: 0.25rem;
    color: var(--fh-ink-muted); background: var(--fh-surface);
    border: 1px solid var(--fh-rule); font-size: 0.75rem; line-height: 1;
    user-select: none;
  }
  [data-hovered] > .fh-grip, [data-selected] > .fh-grip { display: flex; }
  [data-dragging] { opacity: 0.4; }
  [data-drop="before"]::before, [data-drop="after"]::after {
    content: ""; position: absolute; inset-inline: 0; height: 2px;
    background: var(--fh-accent); border-radius: 2px;
  }
  [data-drop="before"]::before { inset-block-start: -0.5rem; }
  [data-drop="after"]::after { inset-block-end: -0.5rem; }
  [data-drop="inside"] { outline: 2px dashed var(--fh-accent); }

`;

export default async function PreviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = await getT();
  // The grip's tooltip is copy, so it comes from the catalog like the rest —
  // injected as a constant the script reads rather than hardcoded in it.
  const dragLabel = JSON.stringify(t("cms.editor.dragBlock"));
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CANVAS_CSS }} />
      <div className="fh-canvas">{children}</div>
      <script
        dangerouslySetInnerHTML={{
          __html: `var FH_DRAG_LABEL = ${dragLabel};` + BRIDGE + DRAG,
        }}
      />
    </>
  );
}
