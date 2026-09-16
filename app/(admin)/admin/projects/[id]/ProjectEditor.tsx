// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef } from "react";
import {
  BlockEditor,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../BlockEditor";
import { saveProjectBlocksAction } from "../../../project-actions";

export function ProjectEditor({
  id,
  initialVersion,
  initialBlocks,
  blockTypes,
  labels,
}: {
  id: string;
  initialVersion: number;
  initialBlocks: EditorNode[];
  blockTypes: EditorBlockType[];
  labels: EditorLabels;
}) {
  const version = useRef(initialVersion);
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      blockTypes={blockTypes}
      labels={labels}
      previewSrc={`/preview/project/${id}`}
      save={async (blocks) => {
        const result = await saveProjectBlocksAction(id, version.current, blocks);
        if (result.version) version.current = result.version;
        return result;
      }}
    />
  );
}
