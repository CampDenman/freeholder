// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  BlockEditor,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../BlockEditor";
import { saveProductDescriptionAction } from "../../../catalog-actions";

export function ProductEditor({
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
  const pending = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    // A lifecycle Server Action can refresh this server component without
    // remounting the client editor. Accept a newer authoritative token, but
    // never roll back a version already returned by an autosave.
    version.current = Math.max(version.current, initialVersion);
  }, [initialVersion]);
  const save = useCallback(
    async (blocks: EditorNode[]) => {
      let result: Awaited<ReturnType<typeof saveProductDescriptionAction>> = {};
      // BlockEditor can begin a second debounced save while the first Server
      // Action is still returning. Serialize here so each call receives the
      // version produced by the prior call instead of racing with a stale
      // compare-and-swap token.
      const run = pending.current.then(async () => {
        result = await saveProductDescriptionAction(id, version.current, blocks);
        if (result.version) version.current = result.version;
      });
      pending.current = run.catch(() => undefined);
      await run;
      return result;
    },
    [id],
  );
  return (
    <BlockEditor
      initialBlocks={initialBlocks}
      blockTypes={blockTypes}
      labels={labels}
      previewSrc={`/preview/product/${id}`}
      save={save}
    />
  );
}
