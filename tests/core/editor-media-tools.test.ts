// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
// The canvas image picker's upload and the crop & focal tool (C2.25, the
// audit's gap 7): an upload travels the media library's own resumable
// pipeline and lands on the block at once; crop, focal point and frame
// shape are one structural edit of the block's props, saved immediately.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  BlockEditor,
  type CropImage,
  type EditorBlockType,
  type EditorLabels,
  type EditorNode,
} from "../../app/(admin)/admin/BlockEditor";

const IMAGE_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_IMAGE_ID = "22222222-3333-4444-8555-666666666666";
const UPLOADED_ID = "33333333-4444-4555-8666-777777777777";
const UPLOAD_ID = "44444444-5555-4666-8777-888888888888";

const blockTypes: EditorBlockType[] = [
  {
    type: "image",
    label: "Image",
    container: false,
    fields: [
      {
        name: "assetId",
        kind: "asset",
        assetKind: "image",
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
    media: {
      upload: "Upload image",
      uploading: "Uploading… {percent}%",
      uploadFailed: "The upload failed.",
      cropTitle: "Crop and focal point",
      focalPoint: "Focal point, {x}% across, {y}% down",
      focalHint: "Click the picture to mark its subject.",
      cropToggle: "Crop the picture",
      cropArea: "Crop window",
      corners: { nw: "Top-left", ne: "Top-right", sw: "Bottom-left", se: "Bottom-right" },
      shape: "Frame shape",
      aspects: {
        original: "Original",
        wide: "Wide",
        landscape: "Landscape",
        square: "Square",
        portrait: "Portrait",
      },
      preview: "Result",
      reset: "Reset",
      apply: "Apply crop",
      loading: "Loading…",
      unavailable: "Unavailable",
    },
    a11y,
  };
}

function canvasMessage(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data }));
}

function latestDraft(postMessage: ReturnType<typeof vi.fn>): EditorNode[] {
  const drafts = postMessage.mock.calls
    .map((call) => call[0] as { draft?: EditorNode[] })
    .filter((message) => Array.isArray(message?.draft));
  return drafts.at(-1)!.draft!;
}

const tick = (ms = 5) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("canvas image upload and crop & focal", () => {
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

  async function renderEditor(
    blocks: EditorNode[],
    loadImage?: (id: string) => Promise<CropImage | null>,
  ) {
    save = vi.fn(async (_blocks: EditorNode[]) => ({ version: 2 }));
    root = createRoot(container);
    await act(async () => {
      root!.render(
        createElement(BlockEditor, {
          initialBlocks: blocks,
          blockTypes,
          labels: labels(),
          previewSrc: "/preview/page/p1",
          save,
          ...(loadImage ? { loadImage } : {}),
        }),
      );
    });
  }

  it("uploads from the picker through the media pipeline and applies the new asset", async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, method: init.method ?? "GET" });
        if (url === "/api/media/uploads" && init.method === "POST") {
          const body = JSON.parse(init.body as string) as { filename: string; bytes: number };
          expect(body).toMatchObject({ filename: "harbour.png", bytes: 4 });
          return Response.json({
            id: UPLOAD_ID,
            strategy: "proxy",
            partSize: null,
            partCount: null,
            expiresAt: new Date().toISOString(),
          });
        }
        if (url === "/api/media" && init.method === "POST") {
          const form = init.body as FormData;
          expect(form.get("uploadId")).toBe(UPLOAD_ID);
          return Response.json({ id: UPLOADED_ID, filename: "harbour.png" });
        }
        return new Response("not found", { status: 404 });
      }),
    );
    await renderEditor([{ id: "i1", type: "image", props: { assetId: IMAGE_ID } }]);
    canvasMessage({
      source: "freeholder-preview",
      blockId: "i1",
      assetPick: { prop: "assetId", x: 40, y: 120 },
    });
    await tick();

    const dialog = container.querySelector('[role="dialog"]')!;
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.getAttribute("aria-label")).toBe("Upload image");
    expect(input.accept).toContain("image/png");
    const file = new File([new Uint8Array([1, 2, 3, 4])], "harbour.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await tick(20);

    // The one pipeline: a reservation, then the bounded proxy upload.
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/media/uploads",
      "POST /api/media",
    ]);
    // Upload is the pick: the picker closes and the block shows the new file.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(latestDraft(postMessage)[0]).toMatchObject({ props: { assetId: UPLOADED_ID } });
    // The form panel's select knows the new file too.
    const option = container.querySelector<HTMLOptionElement>(`option[value="${UPLOADED_ID}"]`);
    expect(option?.textContent).toBe("harbour.png");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
    });
    expect(save.mock.calls.at(-1)?.[0][0]).toMatchObject({ props: { assetId: UPLOADED_ID } });
  });

  it("shows the pipeline's refusal in the picker without touching the block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { message: "That file type is not allowed." } }, { status: 422 }),
      ),
    );
    await renderEditor([{ id: "i1", type: "image", props: { assetId: IMAGE_ID } }]);
    canvasMessage({
      source: "freeholder-preview",
      blockId: "i1",
      assetPick: { prop: "assetId", x: 40, y: 120 },
    });
    await tick();
    const input = container.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["x"], "evil.png", { type: "image/png" })],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await tick(20);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "That file type is not allowed.",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("sets focal point, crop and frame shape from the keyboard and saves at once", async () => {
    const loadImage = vi.fn(async (): Promise<CropImage> => ({
      src: "/media/coastline.jpg",
      width: 1600,
      height: 900,
      focalX: 5000,
      focalY: 5000,
    }));
    await renderEditor([{ id: "i1", type: "image", props: { assetId: IMAGE_ID } }], loadImage);
    canvasMessage({
      source: "freeholder-preview",
      blockId: "i1",
      cropEdit: { prop: "crop", x: 40, y: 120 },
    });
    await tick();
    expect(loadImage).toHaveBeenCalledWith(IMAGE_ID);
    const dialog = container.querySelector('[role="dialog"][aria-label="Crop and focal point"]')!;
    expect(dialog).not.toBeNull();

    const marker = dialog.querySelector<HTMLButtonElement>("[data-focal-marker]")!;
    expect(marker.getAttribute("aria-label")).toBe("Focal point, 50% across, 50% down");
    await act(async () => {
      marker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
      marker.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(marker.getAttribute("aria-label")).toBe("Focal point, 60% across, 49% down");

    // A square frame, then a crop window fitted around the subject.
    const select = dialog.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "square";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // The result swatch uses the renderer's own framing: object-fit cover.
    expect(dialog.querySelector("[data-crop-preview]")?.getAttribute("data-crop-preview")).toBe(
      "aspect",
    );
    const toggle = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      toggle.click();
    });
    const area = dialog.querySelector<HTMLButtonElement>("[data-crop-area]")!;
    expect(area.getAttribute("aria-label")).toBe("Crop window");
    expect(dialog.querySelectorAll("[data-crop-handle]")).toHaveLength(4);
    await act(async () => {
      area.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });

    const apply = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply crop",
    )!;
    await act(async () => {
      apply.click();
    });
    await tick();

    // Square window of a 16:9 picture centred at 60%: w = 5625bp, x = 6000 - 2812.5,
    // then nudged 1% left.
    const expected = {
      aspect: "square",
      focalX: 6000,
      focalY: 4900,
      crop: { x: 3088, y: 0, w: 5625, h: 10_000 },
    };
    expect(container.querySelector('[aria-label="Crop and focal point"]')).toBeNull();
    expect(latestDraft(postMessage)[0]).toMatchObject({ props: { assetId: IMAGE_ID, ...expected } });
    // Structural: persisted immediately, not after the debounce.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0][0]).toMatchObject({ props: expected });

    // One history record: undo restores the uncropped block in one step.
    const undo = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "Undo" || button.textContent === "Undo",
    )!;
    await act(async () => {
      undo.click();
    });
    expect(latestDraft(postMessage)[0]!.props).toEqual({ assetId: IMAGE_ID });
  });

  it("reset clears the placement back to the asset's own framing", async () => {
    await renderEditor(
      [
        {
          id: "i1",
          type: "image",
          props: {
            assetId: IMAGE_ID,
            aspect: "wide",
            focalX: 100,
            focalY: 100,
            crop: { x: 0, y: 0, w: 5000, h: 5000 },
          },
        },
      ],
      async () => ({ src: "/m.jpg", width: 800, height: 800, focalX: 5000, focalY: 5000 }),
    );
    canvasMessage({ source: "freeholder-preview", blockId: "i1", cropEdit: { prop: "crop", x: 0, y: 0 } });
    await tick();
    const dialog = container.querySelector('[aria-label="Crop and focal point"]')!;
    const button = (text: string) =>
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === text)!;
    await act(async () => {
      button("Reset").click();
    });
    await act(async () => {
      button("Apply crop").click();
    });
    await tick();
    expect(save.mock.calls[0]?.[0][0]!.props).toEqual({ assetId: IMAGE_ID, aspect: "original" });
  });

  it("drops the old picture's crop when another asset is picked", async () => {
    await renderEditor([
      {
        id: "i1",
        type: "image",
        props: { assetId: IMAGE_ID, focalX: 100, crop: { x: 0, y: 0, w: 5000, h: 5000 } },
      },
    ]);
    canvasMessage({
      source: "freeholder-preview",
      blockId: "i1",
      assetPick: { prop: "assetId", x: 40, y: 120 },
    });
    await tick();
    const studio = Array.from(
      container.querySelector('[role="dialog"]')!.querySelectorAll("button"),
    ).find((button) => button.textContent === "studio.jpg")!;
    await act(async () => {
      studio.click();
    });
    expect(latestDraft(postMessage)[0]!.props).toEqual({ assetId: OTHER_IMAGE_ID });
  });
});
