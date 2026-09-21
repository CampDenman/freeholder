// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
// Regression test for the §15.1 "Editor keystroke → preview ≤ 100ms p95" row.
//
// Diagnosis (measured 2026-09-21 on 7e95d6a, small dataset, production
// standalone build, PERF_MEASURE_EDITOR=1): keystroke→preview p95 was
// 1,403.4ms against the ≤100ms budget. Cause: BlockEditor debounces autosave
// by 1,200ms and the preview iframe renders only *stored* state — its `src`
// carries `?v={savedVersion}`, bumped solely on a successful save. Every
// keystroke's preview therefore waits for the debounce plus the save
// round-trip plus a full frame reload (~1.3s total).
//
// The contract this test pins: typing into an editor field broadcasts the
// local draft tree to the preview frame on the next animation frame — without
// waiting for the 1,200ms autosave debounce or any server round-trip. The
// autosave itself must still fire on its own debounce.
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BlockEditor,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../app/(admin)/admin/BlockEditor";

const blockTypes: EditorBlockType[] = [
  {
    type: "heading",
    label: "Heading",
    container: false,
    fields: [{ name: "text", kind: "text", required: true, label: "Text" }],
    starter: { text: "A new heading", level: 2 },
  },
];

function labels(): EditorLabels {
  const a11y = {
    title: "Accessibility",
    ok: "OK",
    missingH1: "missingH1",
    multipleH1: "multipleH1",
    headingOrder: "headingOrder",
    imageMissing: "imageMissing",
    imageAltUnset: "imageAltUnset",
    vagueLink: "vagueLink",
    emptyHref: "emptyHref",
    htmlImage: "htmlImage",
    htmlLandmarks: "htmlLandmarks",
    videoMissing: "videoMissing",
    popupH1: "popupH1",
    popupRawHtml: "popupRawHtml",
  };
  return {
    preview: { region: "Preview", desktop: "Desktop", mobile: "Mobile" },
    addBlock: "Add a block",
    cancel: "Cancel",
    remove: "Remove",
    moveUp: "Move up",
    moveDown: "Move down",
    reorder: "Reorder",
    empty: "Empty",
    addItem: "Add item",
    removeItem: "Remove item",
    saving: "Saving…",
    saved: "Saved",
    unsaved: "Unsaved",
    saveFailed: "Save failed",
    retry: "Retry",
    conflict: "Conflict",
    reload: "Reload",
    keepMine: "Keep mine",
    slash: "Slash",
    undo: "Undo",
    redo: "Redo",
    duplicate: "Duplicate",
    copy: "Copy",
    paste: "Paste",
    bold: "Bold",
    italic: "Italic",
    code: "Code",
    link: "Link",
    bullet: "Bullet",
    numbered: "Numbered",
    richHint: "Rich hint",
    a11y,
  };
}

const initialBlocks: EditorNode[] = [
  { id: "b1", type: "heading", props: { text: "Hello", level: 1 } },
];

describe("editor preview draft broadcast", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let postMessage: ReturnType<typeof vi.fn>;
  let save: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    // The preview frame lives in another document; what matters for the
    // contract is that the editor posts the draft to it. Stub every iframe's
    // contentWindow so the broadcast is observable without a real frame.
    postMessage = vi.fn();
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return { postMessage };
      },
    });
    // rAF-throttled broadcast: make each scheduled frame flush on a macrotask
    // so the test can await it deterministically.
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      const timer = setTimeout(() => cb(performance.now()), 0);
      return timer as unknown as number;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderEditor() {
    save = vi.fn(async () => ({ version: 2 }));
    root = createRoot(container);
    await act(async () => {
      root!.render(
        createElement(BlockEditor, {
          initialBlocks,
          blockTypes,
          labels: labels(),
          previewSrc: "/preview/page/p1",
          save,
        }),
      );
    });
  }

  async function typeHeading(text: string) {
    const input = container.querySelector<HTMLInputElement>("#b1-text");
    if (!input) throw new Error("The heading text field is missing.");
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      set.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      // Flush the rAF-throttled broadcast.
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }

  it("broadcasts the local draft to the preview frame without waiting for the autosave debounce", async () => {
    await renderEditor();
    await typeHeading("Hello world");

    // No save yet: the debounce (1,200ms) has not elapsed.
    expect(save).not.toHaveBeenCalled();

    // The preview frame already holds the draft.
    const draftCalls = postMessage.mock.calls
      .map((call) => call[0] as { source?: string; draft?: { blocks?: EditorNode[] } })
      .filter((message) => message?.draft?.blocks);
    expect(draftCalls.length).toBeGreaterThan(0);
    const latest = draftCalls[draftCalls.length - 1]!;
    expect(latest.source).toBe("freeholder-editor");
    expect(latest.draft!.blocks![0]).toMatchObject({
      id: "b1",
      type: "heading",
      props: { text: "Hello world" },
    });
    for (const call of postMessage.mock.calls) {
      expect(call[1]).toBe(window.location.origin);
    }

    // The autosave still fires on its own debounce, unchanged.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ props: expect.objectContaining({ text: "Hello world" }) }),
    ]);
  });
});
