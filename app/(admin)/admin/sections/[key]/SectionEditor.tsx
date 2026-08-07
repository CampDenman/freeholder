// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import {
  BlockEditor,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../BlockEditor";
import { saveSectionBlocksAction } from "../../../cms-actions";

export function SectionEditor({
  sectionKey,
  initialBlocks,
  blockTypes,
  labels,
}: {
  sectionKey: string;
  initialBlocks: EditorNode[];
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
}) {
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      blockTypes={blockTypes}
      labels={labels}
      previewSrc={`/preview/section/${sectionKey}`}
      save={(blocks) => saveSectionBlocksAction(sectionKey, blocks)}
    />
  );
}
