// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
// Canvas edits end to end at the editor: the frame reports, the tree updates
// in the same commit, the draft broadcasts to the canvas without waiting for
// the autosave, and the debounced save persists exactly what the canvas
// showed. Covers flat props, dotted array paths, rich documents and the
// image-replace picker — plus the form panel staying alive beside them.
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

const IMAGE_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_IMAGE_ID = "22222222-3333-4444-8555-666666666666";

const blockTypes: EditorBlockType[] = [
  {
    type: "heading",
    label: "Heading",
    container: false,
    fields: [{ name: "text", kind: "text", required: true, label: "Text" }],
    starter: { text: "A new heading", level: 2 },
  },
  {
    type: "faq",
    label: "FAQ",
    container: false,
    fields: [
      {
        name: "items",
        kind: "list",
        required: true,
        label: "Items",
        itemFields: [
          { name: "question", kind: "text", required: true, label: "Question" },
          { name: "answer", kind: "text", required: true, label: "Answer" },
        ],
      },
    ],
    starter: { items: [{ question: "Q?", answer: "A." }] },
  },
  {
    type: "text",
    label: "Text",
    container: false,
    fields: [{ name: "body", kind: "rich", required: true, label: "Body" }],
    starter: { body: "Write something here." },
  },
  {
    type: "image",
    label: "Image",
    container: false,
    fields: [
      {
        name: "assetId",
        kind: "asset",
        required: false,
        label: "File",
        choices: [
          { value: "", label: "None" },
          { value: IMAGE_ID, label: "coastline.jpg" },
          { value: OTHER_IMAGE_ID, label: "studio.jpg" },
        ],
      },
    ],
    starter: {},
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
    remove: "Remove block",
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
    duplicate: "Duplicate",
    copy: "Copy block",
    paste: "Paste block",
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
    movedTo: "Moved {label} to position {position} of {total}",
    a11y,
  };
}

const initialBlocks: EditorNode[] = [
  { id: "h1", type: "heading", props: { text: "Hello", level: 1 } },
  {
    id: "p1",
    type: "text",
    props: {
      body: [{ type: "paragraph", children: [{ type: "text", text: "Body copy" }] }],
    },
  },
  {
    id: "f1",
    type: "faq",
    props: { items: [{ question: "First question?", answer: "First answer." }] },
  },
  { id: "i1", type: "image", props: { assetId: IMAGE_ID } },
];

function canvasMessage(data: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", { origin: window.location.origin, data }),
  );
}

function latestDraft(postMessage: ReturnType<typeof vi.fn>): EditorNode[] {
  const drafts = postMessage.mock.calls
    .map((call) => call[0] as { source?: string; draft?: EditorNode[] })
    .filter((message) => Array.isArray(message?.draft));
  return drafts.at(-1)!.draft!;
}

describe("canvas edits at the editor", () => {
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

  async function renderEditor() {
    save = vi.fn(async (_blocks: EditorNode[]) => ({ version: 2 }));
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

  async function flushAutosave() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
  }

  it("round-trips a flat canvas edit into the tree, the draft and the save", async () => {
    await renderEditor();
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        edit: { blockId: "h1", prop: "text", value: "Typed on the canvas" },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    // The draft broadcast carries the edit in the same commit — no autosave wait.
    expect(save).not.toHaveBeenCalled();
    expect(latestDraft(postMessage)[0]).toMatchObject({
      props: { text: "Typed on the canvas" },
    });

    await flushAutosave();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0][0]).toMatchObject({
      props: { text: "Typed on the canvas" },
    });
  });

  it("round-trips a dotted path edit into an array prop", async () => {
    await renderEditor();
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        edit: { blockId: "f1", prop: "items.0.question", value: "Edited question?" },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(latestDraft(postMessage)[2]).toMatchObject({
      props: { items: [{ question: "Edited question?", answer: "First answer." }] },
    });

    await flushAutosave();
    const faq = save.mock.calls[0]?.[0][2];
    expect(faq).toMatchObject({
      props: { items: [{ question: "Edited question?", answer: "First answer." }] },
    });
  });

  it("round-trips a rich document edit as the body prop's value", async () => {
    await renderEditor();
    const doc = [
      { type: "paragraph", children: [{ type: "text", text: "Edited " }, { type: "text", text: "bold", marks: ["strong"] }] },
    ];
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        edit: { blockId: "p1", prop: "body", value: doc },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(latestDraft(postMessage)[1]).toMatchObject({ props: { body: doc } });

    await flushAutosave();
    expect(save.mock.calls[0]?.[0][1]).toMatchObject({ props: { body: doc } });
  });

  it("keeps the form panel as a working editing surface beside the canvas", async () => {
    await renderEditor();
    // Form edit first…
    const input = container.querySelector<HTMLInputElement>("#h1-text")!;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    await act(async () => {
      descriptor.set!.call(input, "From the form");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(latestDraft(postMessage)[0]).toMatchObject({ props: { text: "From the form" } });

    // …then a canvas edit of the same prop: both paths own the same tree.
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        edit: { blockId: "h1", prop: "text", value: "From the canvas" },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(latestDraft(postMessage)[0]).toMatchObject({ props: { text: "From the canvas" } });

    await flushAutosave();
    expect(save.mock.calls[0]?.[0][0]).toMatchObject({
      props: { text: "From the canvas" },
    });
  });

  it("opens the picker on the canvas's asset pick and applies the choice", async () => {
    await renderEditor();
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        blockId: "i1",
        assetPick: { prop: "assetId", x: 40, y: 120, width: 300, height: 200 },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-label")).toBe("Replace image");
    const studio = Array.from(dialog!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("studio.jpg"),
    )!;
    expect(studio).toBeDefined();

    await act(async () => {
      studio.click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(latestDraft(postMessage)[3]).toMatchObject({ props: { assetId: OTHER_IMAGE_ID } });

    await flushAutosave();
    expect(save.mock.calls[0]?.[0][3]).toMatchObject({ props: { assetId: OTHER_IMAGE_ID } });
  });

  it("clears the asset when the picker's None choice is taken", async () => {
    await renderEditor();
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        blockId: "i1",
        assetPick: { prop: "assetId", x: 40, y: 120, width: 300, height: 200 },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const none = Array.from(
      container.querySelector('[role="dialog"]')!.querySelectorAll("button"),
    ).find((button) => button.textContent === "None")!;
    await act(async () => {
      none.click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    // undefined clears the prop on the wire, as the form select's empty
    // option does.
    expect(latestDraft(postMessage)[3]).toMatchObject({ props: {} });
  });
});
