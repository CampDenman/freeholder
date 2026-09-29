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
  listCollectionsForEditorAction,
  listProductsForEditorAction,
  mergePageBlocksAction,
  publishPageNowAction,
  reloadWorkingDraftAction,
  saveAsSectionAction,
  savePageBlocksAction,
} from "../../../cms-actions";

export function PageEditor({
  id,
  initialVersion,
  initialBlocks,
  initialPublished,
  blockTypes,
  labels,
}: {
  id: string;
  initialVersion: number;
  initialBlocks: EditorNode[];
  initialPublished: boolean;
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
      published={initialPublished}
      save={async (blocks) => {
        const result = await savePageBlocksAction(id, blocks, versionRef.current);
        if (result.version) versionRef.current = result.version;
        return result;
      }}
      onPublish={async (blocks) => {
        // Save first so the publish validates the tree the owner is looking
        // at, then push it live — one gesture, no unpublish dance.
        const saved = await savePageBlocksAction(id, blocks, versionRef.current);
        if (saved.error) return saved;
        if (saved.version) versionRef.current = saved.version;
        return publishPageNowAction(id);
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
      listCollections={listCollectionsForEditorAction}
      listProducts={listProductsForEditorAction}
    />
  );
}
