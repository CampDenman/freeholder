// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
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
  locale,
  initialBlocks,
  blockTypes,
  labels,
}: {
  sectionKey: string;
  locale: string;
  initialBlocks: EditorNode[];
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
}) {
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      blockTypes={blockTypes}
      labels={labels}
      previewSrc={`/preview/section/${sectionKey}?locale=${encodeURIComponent(locale)}`}
      a11yContext="chrome"
      save={(blocks) => saveSectionBlocksAction(sectionKey, locale, blocks)}
    />
  );
}
