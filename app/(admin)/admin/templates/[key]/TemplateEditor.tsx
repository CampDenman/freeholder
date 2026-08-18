// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import {
  BlockEditor,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../BlockEditor";
import { saveTemplateBlocksAction } from "../../../cms-actions";

export function TemplateEditor({
  templateKey,
  locale,
  initialBlocks,
  blockTypes,
  labels,
}: {
  templateKey: string;
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
      previewSrc={`/preview/template/${encodeURIComponent(templateKey)}?locale=${encodeURIComponent(locale)}`}
      save={(blocks) => saveTemplateBlocksAction(templateKey, locale, blocks)}
    />
  );
}
