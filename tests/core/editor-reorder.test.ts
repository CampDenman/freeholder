// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
// Editor-side proof for C2.25 slice B: a canvas move is the same tree
// operation as a form-panel move, and every surface agrees afterwards.
//
// A move message from the frame becomes a tree update; the draft broadcast
// carries the new order to the canvas in the same commit; the debounced
// autosave persists exactly that tree; and the form panel re-renders into
// the same order. A published page also gets its one-step "Publish changes"
// action (audit gap 8): save then publish, with the draft/live state in a
// chip beside the button.
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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
  {
    type: "text",
    label: "Text",
    container: false,
    fields: [{ name: "body", kind: "rich", required: true, label: "Body" }],
    starter: { body: [] },
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
    preview: {
      region: "Preview",
      desktop: "Desktop",
      mobile: "Mobile",
      replaceImage: "Replace image",
      noImage: "No image chosen",
      noAssets: "No images yet",
      replaceCollection: "Replace collection",
      noCollection: "No collection chosen",
      noCollections: "No collections yet",
      replaceProduct: "Replace product",
      noProduct: "No product chosen",
      noProducts: "No products yet",
    },
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
    unsaved: "Unsaved changes…",
    saveFailed: "Save failed",
    retry: "Retry",
    conflict: "Conflict",
    reload: "Reload",
    keepMine: "Keep mine",
    slash: "Slash",
    undo: "Undo",
    redo: "Redo",
    history: "History",
    historyCurrent: "Current state",
    historyAdd: "Added the {label} block",
    historyRemove: "Removed the {label} block",
    historyDuplicate: "Duplicated the {label} block",
    historyMove: "Moved the {label} block",
    historyEdit: "Edited the {label} block",
    focusMode: "Focus mode",
    exitFocus: "Exit focus mode",
    showOutlines: "Show block outlines",
    hideOutlines: "Hide block outlines",
    zoom: "Zoom",
    chooseCollection: "Choose a collection",
    chooseProducts: "Choose products",
    noCollections: "No collections yet",
    noProducts: "No products yet",
    pickedProducts: "{count} picked",
    done: "Done",
    altText: "Alt text",
    altApply: "Apply",
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
    live: "Live",
    draft: "Draft",
    publishChanges: "Publish changes",
    publishing: "Publishing…",
    publishFailed: "Check the live page before trying again.",
    movedTo: "Moved {label} to position {position} of {total}",
    a11y,
  };
}

const initialBlocks: EditorNode[] = [
  { id: "a", type: "heading", props: { text: "Alpha", level: 1 } },
  { id: "b", type: "heading", props: { text: "Bravo", level: 2 } },
  { id: "c", type: "text", props: { body: [] } },
];

describe("editor reorder round-trip", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let postMessage: ReturnType<typeof vi.fn>;
  let save: Mock<(blocks: EditorNode[]) => Promise<{ version: number }>>;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    postMessage = vi.fn();
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        return { postMessage };
      },
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

  async function renderEditor(options?: {
    published?: boolean;
    onPublish?: (blocks: EditorNode[]) => Promise<{ error?: string; version?: number }>;
  }) {
    save = vi.fn(async (_blocks: EditorNode[]) => ({ version: 2 }));
    root = createRoot(container);
    await act(async () => {
      root!.render(
        createElement(BlockEditor, {
          initialBlocks,
          blockTypes,
          labels: labels(),
          previewSrc: "/preview/page/p1",
          published: options?.published,
          save,
          onPublish: options?.onPublish,
        }),
      );
    });
  }

  /** The order the form panel lists blocks in, read from each card's field ids. */
  function panelOrder(): string[] {
    return Array.from(container.querySelectorAll("input[id$='-text'], textarea"))
      .map((el) => (el.id || "").split("-")[0]!)
      .filter(Boolean);
  }

  function latestDraft(): string[] | undefined {
    const drafts = postMessage.mock.calls
      .map((call) => call[0] as { source?: string; draft?: EditorNode[] })
      .filter((message) => Array.isArray(message?.draft));
    const latest = drafts[drafts.length - 1];
    return latest?.draft?.map((node) => node.id);
  }

  function canvasMove(blockId: string, targetId: string, position: string) {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { source: "freeholder-preview", move: { blockId, targetId, position } },
      }),
    );
  }

  it("a canvas drop reorders the tree, the draft, the autosave and the form panel", async () => {
    await renderEditor();
    expect(panelOrder()).toEqual(["a", "b", "c"]);

    await act(async () => {
      canvasMove("a", "c", "after");
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    // The canvas hears the new order in the same commit — no save round-trip.
    expect(latestDraft()).toEqual(["b", "c", "a"]);
    // The form panel lists the same tree.
    expect(panelOrder()).toEqual(["b", "c", "a"]);

    // The debounced autosave persists exactly that tree.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].map((node) => node.id)).toEqual(["b", "c", "a"]);
  });

  it("a refused canvas drop touches nothing", async () => {
    await renderEditor();
    await act(async () => {
      canvasMove("a", "ghost", "after");
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(latestDraft()).toEqual(["a", "b", "c"]);
    expect(panelOrder()).toEqual(["a", "b", "c"]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("editor-side moves announce their position to screen readers", async () => {
    await renderEditor();
    // Select the first card, then the keyboard move path (Alt+ArrowDown).
    const header = Array.from(container.querySelectorAll("span.font-semibold")).find(
      (el) => el.textContent === "Heading",
    )!.parentElement!;
    await act(async () => {
      header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const live = container.querySelector("p.sr-only");
    expect(live?.textContent).toBe("Moved Heading to position 2 of 3");
    expect(latestDraft()).toEqual(["b", "a", "c"]);
    expect(panelOrder()).toEqual(["b", "a", "c"]);
  });

  it("published pages get a one-step Publish changes action with obvious state", async () => {
    const onPublish = vi.fn(async (_blocks: EditorNode[]) => ({ version: 3 }));
    await renderEditor({ published: true, onPublish });

    const chip = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "Live",
    );
    expect(chip).toBeDefined();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (el) => el.textContent === "Publish changes",
      ),
    ).toBe(true);

    await act(async () => {
      canvasMove("a", "c", "after");
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const button = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent === "Publish changes",
    )!;
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish.mock.calls[0]![0].map((node) => node.id)).toEqual(["b", "c", "a"]);
    // Success reads as the ordinary saved state.
    expect(container.querySelector("p[role='status']")?.textContent).toBe("Saved");
  });

  it("releases the Publishing button and explains a rejected request", async () => {
    await renderEditor({
      published: true,
      onPublish: async () => { throw new Error("connection lost"); },
    });
    const button = Array.from(container.querySelectorAll("button")).find(
      (el) => el.textContent === "Publish changes",
    )!;
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(button.textContent).toBe("Publish changes");
    expect(button.disabled).toBe(false);
    expect(container.textContent).toContain("Check the live page before trying again.");
  });

  it("unpublished pages show the Draft chip without a publish action", async () => {
    await renderEditor({
      published: false,
      onPublish: async () => ({ version: 3 }),
    });
    const chip = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "Draft",
    );
    expect(chip).toBeDefined();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (el) => el.textContent === "Publish changes",
      ),
    ).toBe(false);
  });

  it("editors without a publish prop render no publish chrome at all", async () => {
    await renderEditor();
    expect(
      Array.from(container.querySelectorAll("span")).some(
        (el) => el.textContent === "Live" || el.textContent === "Draft",
      ),
    ).toBe(false);
  });
});
