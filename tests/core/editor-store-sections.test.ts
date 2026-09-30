// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
// Editor-side proof for C2.25 slice C: the audit's remaining gaps closed in
// the editor's own chrome, and store-section picks arriving from the canvas.
//
//   * gap 6 — undo/redo are visible buttons with disabled states, and the
//     history menu lists every recorded edit and jumps to one;
//   * gap 5 — a save stages the next frame in a hidden slot instead of
//     tearing the visible canvas down (the swap itself is the browser
//     journey's claim; here the staging pair is what the component renders);
//   * gap 10 — the zen surface exists, carries the canvas at true height,
//     and owns the persistent-outlines toggle;
//   * store sections — a collection pick and a product pick from the canvas
//     become tree edits, and being structural they save immediately;
//   * gap 7 — the alt editor raised from an image applies through the same
//     canvas-edit path.
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
    type: "collectionShowcase",
    label: "Collection showcase",
    container: false,
    fields: [{ name: "collectionSlug", kind: "text", required: false, label: "Collection" }],
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
    historyCurrent: "Where you are",
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
    movedTo: "Moved {label} to position {position} of {total}",
    a11y,
  };
}

const initialBlocks: EditorNode[] = [
  { id: "h1", type: "heading", props: { text: "Hello", level: 1 } },
  { id: "s1", type: "collectionShowcase", props: {} },
];

function canvasMessage(data: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", { origin: window.location.origin, data }),
  );
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = [...container.querySelectorAll("button")];
  const found = buttons.find((button) => button.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}" (have: ${buttons.map((b) => b.textContent?.trim()).join(", ")})`);
  return found;
}

describe("slice C editor chrome", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let postMessage: ReturnType<typeof vi.fn>;
  let save: Mock<(blocks: EditorNode[]) => Promise<{ version: number }>>;
  let listCollections: Mock<() => Promise<{ slug: string; title: string }[]>>;
  let listProducts: Mock<() => Promise<{ slug: string; title: string; detail: string | null }[]>>;

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
    save = vi.fn(async (_blocks: EditorNode[]) => ({ version: 2 }));
    listCollections = vi.fn(async () => [
      { slug: "wall", title: "The Wall" },
      { slug: "harbour", title: "Harbour Lights" },
    ]);
    listProducts = vi.fn(async () => [
      { slug: "coast-print", title: "Coast print", detail: "A4" },
      { slug: "dune-print", title: "Dune print", detail: null },
    ]);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderEditor(blocks: EditorNode[] = initialBlocks) {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        createElement(BlockEditor, {
          initialBlocks: blocks,
          blockTypes,
          labels: labels(),
          previewSrc: "/preview/page/p1",
          save,
          listCollections,
          listProducts,
        }),
      );
    });
  }

  function textInput(): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>(
      'input[type="text"]',
    );
    if (!input) throw new Error("no text field rendered");
    return input;
  }

  /** React tracks input values; go through the native setter like a browser. */
  function type(input: HTMLInputElement, value: string) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!;
    descriptor.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("gap 6: undo/redo buttons carry disabled states and revert a form edit", async () => {
    await renderEditor();
    const undoButton = buttonByText(container, "Undo");
    const redoButton = buttonByText(container, "Redo");
    expect(undoButton.disabled).toBe(true);
    expect(redoButton.disabled).toBe(true);

    await act(async () => {
      type(textInput(), "Edited from the form");
    });
    expect(undoButton.disabled).toBe(false);

    await act(async () => {
      undoButton.click();
    });
    expect(textInput().value).toBe("Hello");
    expect(redoButton.disabled).toBe(false);

    await act(async () => {
      redoButton.click();
    });
    expect(textInput().value).toBe("Edited from the form");
  });

  it("gap 6: the history menu lists edits and jumps to one", async () => {
    await renderEditor();
    await act(async () => {
      type(textInput(), "First edit");
    });
    // A different field is a different edit — typing runs coalesce per field.
    const fields = [...container.querySelectorAll<HTMLInputElement>('input[type="text"]')];
    await act(async () => {
      type(fields[1]!, "wall");
    });

    const summary = container.querySelector("details > summary") as HTMLElement;
    expect(summary.textContent).toContain("History (2)");
    await act(async () => {
      summary.click();
    });
    const rows = [...container.querySelectorAll("details ol button")].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      "Edited the Heading block",
      "Edited the Collection showcase block",
    ]);

    await act(async () => {
      (container.querySelector("details ol button") as HTMLButtonElement).click();
    });
    expect(textInput().value).toBe("Hello");
  });

  it("gap 5: a save stages the next version in a hidden slot, leaving the visible frame mounted", async () => {
    await renderEditor();
    const frames = () => [...container.querySelectorAll("iframe")];
    expect(frames()).toHaveLength(1);
    expect(frames()[0]!.className).not.toContain("hidden");

    await act(async () => {
      type(textInput(), "Saved change");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(save).toHaveBeenCalled();

    const after = frames();
    expect(after).toHaveLength(2);
    const hidden = after.find((frame) => frame.className.includes("hidden"));
    const visible = after.find((frame) => !frame.className.includes("hidden"));
    expect(hidden).toBeDefined();
    // The saved version counter starts at 0; the first save stages v=1.
    expect(hidden!.getAttribute("src")).toContain("v=1");
    // The visible canvas is the original frame, untouched, until the staging
    // frame reports loaded — in jsdom onLoad never fires, which is exactly
    // what proves nothing was torn down.
    expect(visible).toBe(after[0]);
  });

  it("gap 5: a staged version never swaps in under the owner's caret", async () => {
    // A save stages the next version; if it finishes loading while the owner
    // is typing on the canvas, swapping would hide the element holding their
    // caret and every later keystroke would land in a frame nobody sees.
    await renderEditor();
    const frames = () => [...container.querySelectorAll("iframe")];
    const live = frames()[0]!;
    await act(async () => {
      live.dispatchEvent(new Event("load"));
    });
    const doc = live.contentDocument!;
    // jsdom does not load the preview route; give the frame a body to type in.
    if (!doc.body) {
      doc.replaceChildren(doc.createElement("html"));
      doc.documentElement.appendChild(doc.createElement("body"));
    }
    const paragraph = doc.createElement("p");
    paragraph.setAttribute("data-editable-rich", "body");
    paragraph.setAttribute("contenteditable", "true");
    paragraph.tabIndex = 0;
    paragraph.textContent = "Mid-sentence";
    doc.body.appendChild(paragraph);

    await act(async () => {
      type(textInput(), "Saved change");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(save).toHaveBeenCalled();
    const region = container.querySelector('section[aria-label="Preview"]')!;

    // The owner clicks into the canvas copy just as the staged frame loads.
    paragraph.focus();
    expect(doc.activeElement).toBe(paragraph);
    const staged = frames().find((frame) => frame.className.includes("hidden"))!;
    await act(async () => {
      staged.dispatchEvent(new Event("load"));
    });
    expect(live.className).not.toContain("hidden");
    expect(live.title).toBe("Preview");
    expect(staged.className).toContain("hidden");
    // …and the canvas says a newer version is still on its way.
    expect(region.getAttribute("aria-busy")).toBe("true");

    // Ending the edit lets the waiting version in.
    await act(async () => {
      paragraph.blur();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(staged.className).not.toContain("hidden");
    expect(staged.title).toBe("Preview");
    expect(live.className).toContain("hidden");
    expect(region.hasAttribute("aria-busy")).toBe(false);
  });

  it("gap 10: the zen surface opens with the canvas at true height and the outlines toggle", async () => {
    await renderEditor();
    await act(async () => {
      buttonByText(container, "Focus mode").click();
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-label")).toBe("Focus mode");
    // The zen canvas asks the frame for the page's true height instead of
    // the fixed 32rem window.
    const zenFrame = dialog!.querySelector("iframe");
    expect(zenFrame).not.toBeNull();
    expect(zenFrame!.className).not.toContain("h-[32rem]");
    // The outlines toggle reaches the frame as a draft flag.
    await act(async () => {
      buttonByText(dialog as HTMLElement, "Show block outlines").click();
    });
    const outlineDrafts = postMessage.mock.calls
      .map((call) => call[0] as { draft?: unknown; outlines?: boolean })
      .filter((message) => Array.isArray(message.draft) && message.outlines === true);
    expect(outlineDrafts.length).toBeGreaterThan(0);
    await act(async () => {
      buttonByText(dialog as HTMLElement, "Exit focus mode").click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("store sections: a canvas collection pick writes the slug and saves at once", async () => {
    await renderEditor();
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        blockId: "s1",
        collectionPick: { prop: "collectionSlug", kind: "collection", current: "", x: 8, y: 8, width: 10, height: 10 },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(listCollections).toHaveBeenCalled();
    const row = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Harbour Lights"),
    ) as HTMLButtonElement;
    expect(row).toBeDefined();

    await act(async () => {
      row.click();
    });
    // Structural: the pick persisted immediately rather than waiting out the
    // debounce — the canvas's invisible reload then shows the new shelf.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(save).toHaveBeenCalled();
    const savedTree = save.mock.calls.at(-1)![0];
    expect(savedTree.find((node) => node.id === "s1")?.props.collectionSlug).toBe("harbour");
  });

  it("store sections: a canvas product pick writes the picked slugs in order", async () => {
    await renderEditor();
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        blockId: "s1",
        productPick: { prop: "products", current: "", x: 8, y: 8, width: 10, height: 10 },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    const boxes = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    await act(async () => {
      boxes[1]!.click(); // Dune print first
      boxes[0]!.click(); // then Coast print
    });
    await act(async () => {
      buttonByText(dialog, "Done").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const savedTree = save.mock.calls.at(-1)![0];
    expect(savedTree.find((node) => node.id === "s1")?.props.products).toEqual([
      { slug: "dune-print" },
      { slug: "coast-print" },
    ]);
  });

  it("gap 7: the canvas alt editor applies through the canvas-edit path", async () => {
    await renderEditor();
    await act(async () => {
      canvasMessage({
        source: "freeholder-preview",
        blockId: "h1",
        altEdit: { prop: "alt", current: "Old alt", x: 8, y: 8, width: 10, height: 10 },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    const input = dialog.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("Old alt");
    await act(async () => {
      type(input, "Describes the picture");
      buttonByText(dialog, "Apply").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    const savedTree = save.mock.calls.at(-1)![0];
    expect(savedTree.find((node) => node.id === "h1")?.props.alt).toBe(
      "Describes the picture",
    );
  });
});
