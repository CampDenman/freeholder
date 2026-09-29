// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The drag-and-drop half of the canvas, evaluated as shipped: `CANVAS_DRAG`
// is the exact script the preview frame concatenates after `CANVAS_BRIDGE`
// (see app/(preview)/layout.tsx), so these tests drive a jsdom canvas through
// real DOM events rather than a copy of the logic.
//
// The contract under test: drag start/move/cancel map to tree intents
// (blockId + targetId + position), the drop indicator tracks the pointer, the
// ghost is the drag image, Escape and outside drops never move anything, the
// keyboard path reorders from the grip, and the draft broadcast re-sorts the
// canvas DOM so a refused drop simply never lands.
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_BRIDGE, CANVAS_DRAG } from "../../app/(preview)/canvas-bridge";

const ORIGIN = "http://localhost";

const LABELS = `
var FH_DRAG_LABEL = "Drag to move";
var FH_ANNOUNCE_UP = "Block moved up";
var FH_ANNOUNCE_DOWN = "Block moved down";
var FH_ANNOUNCE_MOVE = "Block moved";
`;

const CANVAS_HTML = `
  <div class="fh-canvas">
    <div data-block-id="a" data-block-type="heading"><h1 data-editable-prop="text" contenteditable="true">Alpha</h1></div>
    <div data-block-id="b" data-block-type="text"><div data-editable-rich="body"><p>Bravo</p></div></div>
    <div data-block-id="c" data-block-type="image"><div class="fh-asset" data-asset-prop="assetId"></div></div>
    <div data-block-id="row" data-block-type="columns" data-container="true">
      <div class="grid">
        <div data-block-id="x" data-block-type="heading"><h2 data-editable-prop="text">X</h2></div>
        <div data-block-id="y" data-block-type="heading"><h2 data-editable-prop="text">Y</h2></div>
      </div>
    </div>
  </div>`;

function canvas(body: string = CANVAS_HTML) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`, {
    runScripts: "outside-only",
    url: `${ORIGIN}/preview/page/p1`,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const parentPost = vi.fn();
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: { postMessage: parentPost },
  });
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  window.eval(LABELS + CANVAS_BRIDGE + CANVAS_DRAG);
  return { window, parentPost, document: window.document };
}

/** Fire a DragEvent-shaped Event; jsdom has no DragEvent, the script reads plain properties. */
function dragEvent(window: JSDOM["window"], type: string, target: Element, init: {
  clientX?: number;
  clientY?: number;
  dataTransfer?: unknown;
}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "target", { value: target, enumerable: true });
  if (init.clientX !== undefined) {
    Object.defineProperty(event, "clientX", { value: init.clientX });
  }
  if (init.clientY !== undefined) {
    Object.defineProperty(event, "clientY", { value: init.clientY });
  }
  if (init.dataTransfer !== undefined) {
    Object.defineProperty(event, "dataTransfer", { value: init.dataTransfer });
  }
  target.dispatchEvent(event);
  return event;
}

function dataTransferStub() {
  return {
    effectAllowed: "",
    setData: vi.fn((_mime: string, _data: string) => undefined),
    setDragImage: vi.fn((_el: HTMLElement, _x: number, _y: number) => undefined),
  };
}

function movesOf(parentPost: ReturnType<typeof vi.fn>) {
  return parentPost.mock.calls
    .map((call) => call[0] as { source?: string; move?: Record<string, string> })
    .filter((message) => message?.source === "freeholder-preview" && message.move)
    .map((message) => message.move);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 40));

describe("the canvas drag script", () => {
  it("injects a keyboard-operable grip into every block", () => {
    const { document } = canvas();
    const grips = document.querySelectorAll(".fh-grip");
    expect(grips.length).toBe(6);
    for (const grip of grips) {
      expect(grip.tagName).toBe("BUTTON");
      expect(grip.getAttribute("draggable")).toBe("true");
      expect(grip.getAttribute("aria-label")).toBe("Drag to move");
      const svg = grip.querySelector("svg[aria-hidden='true']");
      expect(svg).not.toBeNull();
      expect(svg!.querySelectorAll("circle").length).toBe(6);
    }
  });

  it("dragstart lifts a translucent live-sized ghost as the drag image", () => {
    const { window, document } = canvas();
    const grip = document.querySelector('[data-block-id="a"] > .fh-grip')!;
    const stub = dataTransferStub();
    dragEvent(window, "dragstart", grip, { clientX: 30, clientY: 10, dataTransfer: stub });

    expect(stub.effectAllowed).toBe("move");
    expect(stub.setData).toHaveBeenCalledWith("text/plain", "a");
    expect(stub.setDragImage).toHaveBeenCalledTimes(1);
    const [ghost, offsetX, offsetY] = stub.setDragImage.mock.calls[0]!;
    expect(ghost.className).toContain("fh-ghost");
    expect(ghost.textContent).toContain("Alpha");
    expect(ghost.querySelector(".fh-grip")).toBeNull();
    expect(ghost.style.width).not.toBe("");
    // The ghost sits under the pointer where the block was grabbed.
    expect(offsetX).toBe(30);
    expect(offsetY).toBe(10);
    expect(document.querySelector('[data-block-id="a"]')?.getAttribute("data-dragging")).toBe(
      "true",
    );
  });

  it("tracks the drop zone under the pointer and posts the intent on drop", () => {
    const { window, document, parentPost } = canvas();
    const grip = document.querySelector('[data-block-id="a"] > .fh-grip')!;
    const target = document.querySelector('[data-block-id="b"]')!;
    dragEvent(window, "dragstart", grip, { clientX: 4, clientY: 4, dataTransfer: dataTransferStub() });

    target.getBoundingClientRect = () =>
      ({ top: 100, height: 40, left: 0, width: 80, right: 80, bottom: 140, x: 0, y: 100, toJSON: () => ({}) });

    dragEvent(window, "dragover", target, { clientX: 40, clientY: 130 });
    expect(target.getAttribute("data-drop")).toBe("after");

    dragEvent(window, "dragover", target, { clientX: 40, clientY: 110 });
    expect(target.getAttribute("data-drop")).toBe("before");

    dragEvent(window, "drop", target, {});
    expect(movesOf(parentPost)).toEqual([
      { blockId: "a", targetId: "b", position: "before" },
    ]);
    // The canvas does not move the DOM itself: the editor's draft broadcast
    // re-sorts it, and a refused drop therefore never lands.
    expect(document.querySelector(".fh-canvas > [data-block-id]")?.getAttribute("data-block-id")).toBe("a");
  });

  it("offers the inside zone for an empty container", () => {
    const { window, document, parentPost } = canvas(`
      <div class="fh-canvas">
        <div data-block-id="row" data-block-type="columns" data-container="true"><div class="grid"></div></div>
        <div data-block-id="a" data-block-type="heading"><h1 data-editable-prop="text" contenteditable="true">Alpha</h1></div>
      </div>`);
    const grip = document.querySelector('[data-block-id="a"] > .fh-grip')!;
    const row = document.querySelector('[data-block-id="row"]')!;
    dragEvent(window, "dragstart", grip, { clientX: 4, clientY: 4, dataTransfer: dataTransferStub() });
    dragEvent(window, "dragover", row, { clientX: 40, clientY: 4 });
    expect(row.getAttribute("data-drop")).toBe("inside");
    dragEvent(window, "drop", row, {});
    expect(movesOf(parentPost)).toEqual([
      { blockId: "a", targetId: "row", position: "inside" },
    ]);
  });

  it("marks nothing when hovering the block being dragged", () => {
    const { window, document } = canvas();
    const grip = document.querySelector('[data-block-id="a"] > .fh-grip')!;
    dragEvent(window, "dragstart", grip, { clientX: 4, clientY: 4, dataTransfer: dataTransferStub() });
    const self = document.querySelector('[data-block-id="a"]')!;
    dragEvent(window, "dragover", self, { clientX: 4, clientY: 4 });
    expect(self.getAttribute("data-drop")).toBeNull();
  });

  it("Escape or a drop outside every zone reverts: no message, indicator cleared", () => {
    const { window, document, parentPost } = canvas();
    const grip = document.querySelector('[data-block-id="a"] > .fh-grip')!;
    dragEvent(window, "dragstart", grip, { clientX: 4, clientY: 4, dataTransfer: dataTransferStub() });
    const target = document.querySelector('[data-block-id="b"]')!;
    dragEvent(window, "dragover", target, { clientX: 40, clientY: 9999 });
    expect(target.getAttribute("data-drop")).toBe("after");

    // Escape ends a native drag with dragend and no drop.
    dragEvent(window, "dragend", grip, {});
    expect(target.getAttribute("data-drop")).toBeNull();
    expect(document.querySelector("[data-dragging]")).toBeNull();
    expect(document.querySelector(".fh-ghost")).toBeNull();
    expect(movesOf(parentPost)).toEqual([]);

    // A drop that never saw a valid zone posts nothing either.
    dragEvent(window, "dragstart", grip, { clientX: 4, clientY: 4, dataTransfer: dataTransferStub() });
    dragEvent(window, "drop", document.body, {});
    expect(movesOf(parentPost)).toEqual([]);
    expect(document.querySelector('[data-block-id="a"]')?.getAttribute("data-dragging")).toBe("true");
    dragEvent(window, "dragend", grip, {});
  });

  it("reorders the canvas DOM from the draft broadcast, top level and nested", () => {
    const { window, document } = canvas();
    const draftMessage = (blocks: unknown) =>
      window.dispatchEvent(
        new window.MessageEvent("message", {
          origin: ORIGIN,
          data: { source: "freeholder-editor", draft: blocks },
        }),
      );
    const order = () =>
      Array.from(document.querySelectorAll("[data-block-id]")).map((el) =>
        el.getAttribute("data-block-id"),
      );

    draftMessage([
      { id: "b", type: "text", props: {} },
      { id: "a", type: "heading", props: { text: "Alpha" } },
      { id: "c", type: "image", props: {} },
      {
        id: "row",
        type: "columns",
        props: {},
        children: [
          { id: "y", type: "heading", props: { text: "Y" } },
          { id: "x", type: "heading", props: { text: "X" } },
        ],
      },
    ]);
    expect(order()).toEqual(["b", "a", "c", "row", "y", "x"]);
  });

  it("leaves the DOM alone while its level is being typed into", () => {
    const { window, document } = canvas();
    const editable = document.querySelector<HTMLElement>(
      '[data-block-id="a"] [data-editable-prop]',
    )!;
    editable.focus();
    window.dispatchEvent(
      new window.MessageEvent("message", {
        origin: ORIGIN,
        data: {
          source: "freeholder-editor",
          draft: [
            { id: "b", type: "text", props: {} },
            { id: "a", type: "heading", props: { text: "Alpha" } },
            { id: "c", type: "image", props: {} },
            {
              id: "row",
              type: "columns",
              props: {},
              children: [
                { id: "y", type: "heading", props: {} },
                { id: "x", type: "heading", props: {} },
              ],
            },
          ],
        },
      }),
    );
    // The typed-into level is untouched; a level the caret is not in re-sorts.
    expect(document.querySelector(".fh-canvas > [data-block-id]")?.getAttribute("data-block-id")).toBe("a");
    const nested = Array.from(
      document.querySelectorAll('[data-block-id="row"] [data-block-id]'),
    ).map((el) => el.getAttribute("data-block-id"));
    expect(nested).toEqual(["y", "x"]);
  });

  it("moves a block from its grip with the arrow keys, announcing the move", async () => {
    const { window, document, parentPost } = canvas();
    const grip = document.querySelector('[data-block-id="a"] > .fh-grip')!;

    const arrow = (key: string) => {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      grip.dispatchEvent(event);
      return event;
    };

    const down = arrow("ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(movesOf(parentPost)).toEqual([
      { blockId: "a", targetId: "b", position: "after" },
    ]);
    await flush();
    expect(document.querySelector(".fh-sr-only")?.textContent).toBe("Block moved down");

    // The editor applies the move and broadcasts the new draft; the frame
    // re-sorts, so the next ArrowUp sees b as a's previous sibling.
    window.dispatchEvent(
      new window.MessageEvent("message", {
        origin: ORIGIN,
        data: {
          source: "freeholder-editor",
          draft: [
            { id: "b", type: "text", props: {} },
            { id: "a", type: "heading", props: { text: "Alpha" } },
            { id: "c", type: "image", props: {} },
            {
              id: "row",
              type: "columns",
              props: {},
              children: [
                { id: "x", type: "heading", props: {} },
                { id: "y", type: "heading", props: {} },
              ],
            },
          ],
        },
      }),
    );
    arrow("ArrowUp");
    expect(movesOf(parentPost)).toEqual([
      { blockId: "a", targetId: "b", position: "after" },
      { blockId: "a", targetId: "b", position: "before" },
    ]);
    await flush();
    expect(document.querySelector(".fh-sr-only")?.textContent).toBe("Block moved up");
  });

  it("does nothing at the edge of a level", () => {
    const { window, document, parentPost } = canvas();
    const first = document.querySelector('[data-block-id="a"] > .fh-grip')!;
    const event = new window.KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(movesOf(parentPost)).toEqual([]);
  });

  it("nests through the keyboard path by walking same-level siblings only", () => {
    const { window, document, parentPost } = canvas();
    const yGrip = document.querySelector('[data-block-id="y"] > .fh-grip')!;
    const event = new window.KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });
    yGrip.dispatchEvent(event);
    expect(movesOf(parentPost)).toEqual([
      { blockId: "y", targetId: "x", position: "before" },
    ]);
  });
});
