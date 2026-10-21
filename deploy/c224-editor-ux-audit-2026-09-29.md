<!-- Copyright (C) 2026 Tony Aly -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# C2.25 current-state editor UX audit — 2026-09-29

First evidence for **C2.25 World-class visual editing** (MASTER.md §43.7;
opened as C2.24 on `plan/world-class-commerce-editor`, renumbered C2.25 when
#445 merged after #446 had taken C2.24 for the storefront-commerce-blocks
item): *"true
what-you-see-is-what-renders editing — the page itself is the canvas (inline
text/image editing on the rendered surface), drag-and-drop blocks and sections
anywhere on the site AND in store contexts (collection layouts, product rows),
no separate preview frame required for ordinary edits."*

Owner directive (2026-09-29): *"WYSIWYG needs to be amazing and drag and drop
for the store and the rest of the site (last time I tried the wysiwyg it… was
not very wysiwyg)."*

This document audits what **exists** on `origin/main` (`e9520fa`, audited
before the C2.24→C2.25 / C3.25→C3.26 plan renumber landed; the renumber
changed IDs only, no product code). It checks no
boxes and proposes no architecture — the target-behavior column is the design
north star for the overhaul, which is planned separately. Nothing here is
committed except this file; the scratch driver spec and raw screenshots stay
local in `test-results/uxaudit/`.

## Method

- **Build:** production standalone (`pnpm build`) of `origin/main` at `e9520fa`,
  booted via the repo's own browser harness (`playwright.a11y.config.ts`,
  `scripts/start-browser-server.mjs`) on `http://localhost:3100`.
- **Browser:** headless Chromium (Playwright, repo-pinned).
- **Database:** disposable PostgreSQL at `127.0.0.1:55432`, fresh
  `freeholder_ux_audit_test`, migrated; truncated and reseeded per run
  (`tests/browser/database.ts` pattern).
- **Fixture:** owner session (`tests/browser/owner-session.ts` pattern); full
  Aurora Coast demo installed through the app's `demo.install` API
  (`publish: true`) — 7 pages incl. a home page of heading / text / image /
  button / divider / columns; plus 2 active public products seeded directly.
- **Driven surfaces:** `/admin/pages/[id]` (the editor), `/admin/products`,
  `/admin/products/[id]`, public `/` and `/products/[slug]` in an anonymous
  context. Interactions were executed with real pointer/keyboard events where
  headless Chromium allows (HTML5 cross-iframe drags are not; those went
  through the frame's own shipped drag listeners and are marked as such).
- **Sanitization:** no secrets, tokens or environment values appear above or in
  the evidence; fixture identities are `@example.test`.

## What exists today (one paragraph)

The editor is a **two-pane screen**: a left-hand form panel with one card per
block (schema-derived fields, per-card up/down/duplicate/remove buttons) and a
right-hand **iframe** (`/preview/page/[id]`, 32rem tall, desktop/mobile widths)
that server-renders the saved tree through the real `renderBlocks` — the one
genuinely world-class decision, since the canvas can never disagree with the
public page for long. A `postMessage` bridge syncs selection both ways and
layers the local draft onto `contenteditable` elements. Autosave is debounced
(1.2s), writes a revision per save, and bumps the frame's version so the iframe
reloads from stored state. Inline typing on the canvas exists for **three
block surfaces only** (heading text, button label, phone-callout props);
everything else — body copy, images, FAQ, columns, store blocks — is form-only.

## Interaction-by-interaction findings

World-class bar: **the page is the canvas** — click anything, edit it where it
renders, drag it where you want it, and trust what you see.

| # | A first-time owner tries… | What actually happens (observed 2026-09-29) | Severity |
|---|---|---|---|
| 1 | Open the editor and just edit | Two panes: block-form cards left, small preview iframe right; the page is not the canvas. Editor sits under ~12 rows of admin nav. | Blocks |
| 2 | Click the big headline and type | Works — caret lands in the H1 (`contenteditable`), form mirrors live, autosave persists. The one fully world-class interaction. | — (works) |
| 3 | Click a paragraph and type | **Not typeable.** The text block has no editable surface on the canvas; clicking only selects the block. Owner must find the "Body" field in the left form. No formatting toolbar on canvas anywhere. | Blocks |
| 4 | Undo a mistake | Ctrl+Z works (tree history exists). But there are **0 visible undo/redo controls** — keyboard-only, undiscoverable. | Papercut→Blocks |
| 5 | Change a heading's size | Form select only; the canvas keeps the old size until autosave (~1.5s) **reloads the entire iframe**. Anything a text patch can't express waits for a full-frame refresh. | Blocks |
| 6 | Drag the CTA button below the picture | Drag exists but is nearly invisible: a ⠿ grip appears only on hover/selection; the block body itself doesn't drag; mid-drag the only affordance is a 2px line (`data-drop`); the drag ghost is the tiny grip glyph (no `setDragImage`), not a block preview. Drop → tree update → autosave → full frame re-render. | Blocks |
| 7 | Drop a new block between two others | "+ Add block"/"/" opens a searchable palette (48 entries), but the new block **always appends to the end** of the form list. No insert-at-position, no dragging palette items onto the canvas. | Blocks |
| 8 | Swap the hero image | Canvas image is inert. Only control is a 4-option `<select>` of already-uploaded assets in the form panel. No upload, picker, alt-text on canvas, crop or focal controls. | Blocks |
| 9 | Update the live site | Staged and slightly alarming: type → 1.2s autosave → iframe reload → the only control is an **Unpublish/Publish toggle**, so pushing edits live means unpublishing first (the storefront **404s mid-flow**, observed) and publishing again. The preview is staff-auth and never shows the real public page (no header/footer chrome). | Blocks |
| 10 | Compose a store section | Palette store entries are exactly three: **Products list** (auto vertical list of ALL active products; one checkbox), **Product details** (bind one product by pasting its **UUID + slug** into text fields), **Product card** (one slug field, bordered mini-card). No product grid, no collection layouts, no pick-products UI, no merchandising controls. | Blocks |
| 11 | Merchandise a product | `/admin/products` is a list; the product editor is a plain form (name, kind, visibility, variants, SEO…). No preview of how the product sits on a page. | Blocks |
| 12 | See the new product on the site | `/products/<slug>` returns **404** for a new, active, public product — product pages exist only if hand-built as CMS pages. The seeded demo site ships no store pages at all. | Blocks |
| 13 | Work on a long page | The canvas is a fixed 32rem-tall window; the page scrolls inside it. Only desktop/mobile widths; no zoom, no full-page view. | Papercut |
| 14 | See what's editable | Block outlines are hover-only; with the mouse still, the canvas looks like a static page. A first-timer cannot tell what is a block, what is text, what is an image. | Papercut |

## Severity-ordered gap list (top 10)

1. **Canvas is a preview, not the surface** — form-panel-first architecture; the page itself is not editable. (findings 1, 3)
2. **Inline editing covers 3 of 40+ block surfaces**; body copy — the highest-frequency edit — is form-only, and rich text has no on-canvas toolbar. (3, 13-adjacent)
3. **No visual store composition** — no product-grid or collection-layout blocks, no pick/order/merchandise UI; store blocks are form-bound and one is UUID-pasting. (10, 11)
4. **Drag and drop is hidden and under-tooled** — hover-only grip, no block ghost, no drag-from-palette, no insert-at-position, append-only adds. (6, 7)
5. **Structural edits round-trip through a full iframe reload** instead of instant in-place updates. (5)
6. **No visible undo/redo** (or history) in the editor chrome. (4)
7. **Images are inert on the canvas** — select-dropdown asset swapping only. (8)
8. **Publishing a live edit unpublishes the site first** (404 mid-flow); no atomic "update live" action, and no true public-view preview. (9)
9. **New products have no pages** — store discovery is manual block placement. (12)
10. **Editor chrome competes with the canvas** — admin grid wraps the surface; hover-only affordances give no persistent sense of structure. (1, 14, 13)

## Target behavior per gap (the north star, not a plan)

| Gap | Target behavior |
|---|---|
| 1 | Opening a page shows **the page**, full-bleed, as the primary surface. Form controls appear only on demand (selection, right-click, or a slim contextual rail), never as the default view. |
| 2 | **Every rendered text is clickable-to-edit**, caret in place; a floating toolbar (bold, italic, link, lists, clear) appears at the selection; formatted text renders formatted while typing — no markup syntax visible, ever. |
| 3 | Store composition is **canvas-native**: drag in a product-grid or collection block, pick products from a visual picker (thumbnails, search, multi-select), arrange rows/columns on the canvas, and merchandise (featured, order, badge) inline. (Block set itself is C3.26 — world-class merchandising.) |
| 4 | Blocks drag **by their body**: hover shows a handle and a move cursor; dragging lifts a translucent live-sized ghost that follows the pointer with a gap/caret showing the exact landing zone; palette items drag onto the canvas; dropping between blocks inserts there. |
| 5 | Ordinary structural changes (level, alignment, add, move, delete) **update the canvas in place, immediately and optimistically**; a frame reload is an invisible reconciliation backstop, never a visible refresh. |
| 6 | Undo/redo buttons sit in the editor's own chrome with a visible history menu; keyboard shortcuts remain. |
| 7 | Clicking an image opens a **media picker anchored to that image**: upload, pick from library, edit alt text, crop/focal point — all without leaving the canvas. |
| 8 | One obvious **"Publish changes"** action updates the live page atomically (draft stays live-safe throughout); an optional "View live" opens the real public URL. Unpublish is a separate, deliberately-scary action. |
| 9 | Creating a product offers an automatic, on-template page at `/products/<slug>` the moment it's published; the storefront never depends on hand-placed blocks for basic discovery. |
| 10 | Editing gets a **dedicated surface** (zen/full-screen mode) with persistent block outlines, zoom and device widths, and the page's true height. |

## What the overhaul must preserve

The current canvas's one world-class property is that it renders the **same
server function as the public page** (`renderBlocks` through the iframe) — the
canvas cannot lie about what will ship. The §15.7 a11y gate already runs
against this editor. Any redesign keeps that truthfulness (server-rendered
blocks, tree-as-source-of-truth) while moving the surface from form-first to
canvas-first; the F-criteria gates and the honest-preview principle outlive
this audit.
