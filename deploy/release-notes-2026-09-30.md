<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# Release notes — session digest 2026-09-30

Product version remains **0.1.0**, in active development. This is a session
digest, not a release-candidate announcement and not a claim of deployment.
`CHANGELOG.md`, generated from `.changeset/`, is the canonical owner-facing
change list. Refresh GitHub before treating anything below as shipped.

## C2.25 — upload, crop and focal point on the canvas (box closed)

The last open clause of the world-class visual editor: the audit's gap 7
asked for a picker anchored to the image that can upload, pick, edit alt
text and set crop/focal point without leaving the canvas. Pick and alt text
landed in slices A and C; this closes the rest.

- **Upload from the canvas picker.** "Upload image" sits at the top of the
  image's anchored picker. The file travels the media library's own
  resumable pipeline — the browser half now lives in one client
  (`app/(admin)/admin/media/upload-client.ts`) shared by the library's
  upload form and the canvas, so there is no second upload path — and the
  Asset it becomes is applied to the block at once and joins the form
  panel's choices. A refusal (type, size, scan) is shown in the picker and
  leaves the block untouched.
- **Crop and focal point are media concepts now.** The asset's focal point
  (already editable in the media library, but honoured by no renderer) is
  returned by `media.resolveImage`. The image block gains a frame shape
  (`aspect`), a per-placement focal override and an optional crop
  rectangle. A crop is a window onto the ordinary `<picture>` — same
  srcset, same renditions, nothing re-encoded — drawn by one pure function
  (`src/core/media/framing.ts`) that the public renderer, the canvas and the
  crop tool's live preview share.
- **The crop & focus tool.** Anchored to the picture on the canvas: click to
  mark the subject, choose a shape, toggle a crop window with four corner
  handles and a draggable body. Every control is a real button; arrows nudge
  1%, Shift 10%. Apply is one undoable, structural edit that saves at once;
  picking a different picture drops the old crop.
- **No migration.** Focal columns already existed on `assets`; overrides and
  crops are block props on the CMS tree, so revisions, draft/publish, export
  and restore carry them unchanged.
- **Proof.** `tests/core/media-framing.test.ts`,
  `tests/core/editor-media-tools.test.ts`, the resolve assertion in
  `tests/core/media.test.ts`, and the
  `tests/browser/editor-media-tools.spec.ts` journey: upload on the canvas →
  the reservation completes into a ready Asset → mark the subject, square
  frame, crop → saved → publish → the public page draws the same square
  window of the uploaded file.
