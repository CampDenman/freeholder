// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Binds the generic block editor to one page.
//
// A thin wrapper so `BlockEditor` never learns what it is editing — the same
// component drives a page and a chrome Section, and will drive an email
// template when §30 lands.
import {
  BlockEditor,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../BlockEditor";
import { savePageBlocksAction } from "../../../cms-actions";

export function PageEditor({
  id,
  initialBlocks,
  blockTypes,
  labels,
}: {
  id: string;
  initialBlocks: EditorNode[];
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
}) {
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      blockTypes={blockTypes}
      labels={labels}
      previewSrc={`/preview/page/${id}`}
      save={(blocks) => savePageBlocksAction(id, blocks)}
    />
  );
}
