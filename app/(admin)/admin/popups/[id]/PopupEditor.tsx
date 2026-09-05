// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// The same block editor as a page and a chrome section, pointed at a popup.
//
// `a11yContext="popup"` is the whole reason this is worth a file: the hints
// panel is live as the owner works, so "a popup must not contain an H1" is
// something they learn while writing rather than something that refuses them
// when they try to switch it on.
import {
  BlockEditor,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../BlockEditor";
import { savePopupBlocksAction } from "../../../popup-actions";

export function PopupEditor({
  popupId,
  initialBlocks,
  blockTypes,
  labels,
}: {
  popupId: string;
  initialBlocks: EditorNode[];
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
}) {
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      blockTypes={blockTypes}
      labels={labels}
      previewSrc={`/preview/popup/${popupId}`}
      a11yContext="popup"
      save={(blocks) => savePopupBlocksAction(popupId, blocks)}
    />
  );
}
