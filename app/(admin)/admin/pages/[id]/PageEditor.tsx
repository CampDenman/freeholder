// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// Binds the generic block editor to one page.
//
// A thin wrapper so `BlockEditor` never learns what it is editing — the same
// component drives a page and a chrome Section, and will drive an email
// template when §30 lands.
import { useRef } from "react";
import {
  BlockEditor,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../BlockEditor";
import {
  detachSectionAction,
  mergePageBlocksAction,
  reloadWorkingDraftAction,
  saveAsSectionAction,
  savePageBlocksAction,
} from "../../../cms-actions";

export function PageEditor({
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
  const versionRef = useRef(initialVersion);
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      blockTypes={blockTypes}
      labels={labels}
      previewSrc={`/preview/page/${id}`}
      a11yContext="page"
      save={async (blocks) => {
        const result = await savePageBlocksAction(id, blocks, versionRef.current);
        if (result.version) versionRef.current = result.version;
        return result;
      }}
      onKeepMine={async (blocks, serverVersion) => {
        const result = await mergePageBlocksAction(id, blocks, serverVersion);
        if (result.version) versionRef.current = result.version;
        return result;
      }}
      onReloadDraft={async () => {
        const result = await reloadWorkingDraftAction(id);
        if (result.version) versionRef.current = result.version;
        return {
          error: result.error,
          version: result.version,
          blocks: result.blocks as EditorNode[] | undefined,
        };
      }}
      onSaveAsSection={async (nodes, name) => {
        const result = await saveAsSectionAction(name, nodes);
        return {
          error: result.error,
          instance: result.instance,
        };
      }}
      onDetachSection={async (node) => {
        const key = node.props.sectionKey;
        if (typeof key !== "string") return { error: "That block is not a Section." };
        const result = await detachSectionAction(key);
        return { error: result.error, nodes: result.nodes as EditorNode[] | undefined };
      }}
    />
  );
}
