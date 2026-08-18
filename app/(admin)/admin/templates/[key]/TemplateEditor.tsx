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
  a11yContext = "page",
}: {
  templateKey: string;
  locale: string;
  initialBlocks: EditorNode[];
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
  a11yContext?: "page" | "email";
}) {
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      blockTypes={blockTypes}
      labels={labels}
      previewSrc={`/preview/template/${encodeURIComponent(templateKey)}?locale=${encodeURIComponent(locale)}`}
      a11yContext={a11yContext}
      save={(blocks) => saveTemplateBlocksAction(templateKey, locale, blocks)}
    />
  );
}
