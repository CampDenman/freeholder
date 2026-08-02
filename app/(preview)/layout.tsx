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

/** Selection affordances exist only here, never on the real page. */
const CANVAS_CSS = `
  .fh-canvas { display: grid; gap: 2rem; max-width: 48rem; margin: 0 auto; padding: 2.5rem 1.5rem; }
  [data-block-id] { outline-offset: 3px; cursor: pointer; }
  [data-hovered] { outline: 1px dashed var(--fh-rule); }
  [data-selected] { outline: 2px solid var(--fh-accent); }
`;

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CANVAS_CSS }} />
      <div className="fh-canvas">{children}</div>
      <script dangerouslySetInnerHTML={{ __html: BRIDGE }} />
    </>
  );
}
