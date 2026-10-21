// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
// C2.25: autosave and publishing must share one page version sequence.
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorNode } from "../../app/(admin)/admin/BlockEditor";

let editorProps: {
  save: (blocks: EditorNode[]) => Promise<{ error?: string; version?: number }>;
  onPublish: (blocks: EditorNode[]) => Promise<{ error?: string; version?: number }>;
} | undefined;

vi.mock("../../app/(admin)/admin/BlockEditor", () => ({
  BlockEditor: (props: typeof editorProps) => {
    editorProps = props;
    return null;
  },
}));

const { savePageBlocksAction, publishPageNowAction } = vi.hoisted(() => ({
  savePageBlocksAction: vi.fn(),
  publishPageNowAction: vi.fn(),
}));
vi.mock("../../app/(admin)/cms-actions", () => ({
  savePageBlocksAction,
  publishPageNowAction,
  detachSectionAction: vi.fn(),
  listCollectionsForEditorAction: vi.fn(),
  listProductsForEditorAction: vi.fn(),
  mergePageBlocksAction: vi.fn(),
  reloadWorkingDraftAction: vi.fn(),
  saveAsSectionAction: vi.fn(),
}));

import { PageEditor } from "../../app/(admin)/admin/pages/[id]/PageEditor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("page editor publishing", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    editorProps = undefined;
    vi.clearAllMocks();
  });

  it("waits for autosave, publishes that version, and uses the published version for the next edit", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const pendingAutosave = deferred<{ version: number }>();
    savePageBlocksAction
      .mockReturnValueOnce(pendingAutosave.promise)
      .mockResolvedValueOnce({ version: 3 })
      .mockResolvedValueOnce({ version: 5 });
    publishPageNowAction.mockResolvedValue({ version: 4 });
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(PageEditor, {
        id: "page-1",
        initialVersion: 1,
        initialBlocks: [],
        initialPublished: true,
        blockTypes: [],
        labels: {} as never,
      }));
    });

    const blocks: EditorNode[] = [{ id: "heading", type: "heading", props: { text: "Edited" } }];
    const autosave = editorProps!.save(blocks);
    const publish = editorProps!.onPublish(blocks);
    await Promise.resolve();
    expect(savePageBlocksAction).toHaveBeenCalledTimes(1);

    pendingAutosave.resolve({ version: 2 });
    await autosave;
    await publish;
    const saveCalls = savePageBlocksAction.mock.calls as unknown[][];
    expect(saveCalls.map((call) => call[2])).toEqual([1, 2]);
    expect(publishPageNowAction).toHaveBeenCalledOnce();
    expect(publishPageNowAction).toHaveBeenCalledWith("page-1", 3);

    await editorProps!.save(blocks);
    expect(saveCalls[2]?.[2]).toBe(4);
  });
});
