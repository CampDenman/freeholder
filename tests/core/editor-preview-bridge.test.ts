// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The frame half of the §15.1 keystroke→preview fix: `CANVAS_BRIDGE` is the
// exact script the preview iframe ships (see app/(preview)/layout.tsx), so
// these tests evaluate that string against a jsdom canvas rather than a copy
// of its logic.
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_BRIDGE } from "../../app/(preview)/canvas-bridge";

const ORIGIN = "http://localhost";

function canvas(body: string) {
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
  // scrollIntoView is not implemented by jsdom; selection messages reach for it.
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  window.eval(CANVAS_BRIDGE);
  return { window, parentPost, document: window.document };
}

function draftMessage(window: JSDOM["window"], blocks: unknown) {
  window.dispatchEvent(
    new window.MessageEvent("message", {
      origin: ORIGIN,
      data: { source: "freeholder-editor", draft: blocks },
    }),
  );
}

const CANVAS_HTML = `
  <div data-block-id="h1" data-block-type="heading">
    <h1 data-editable-prop="text">Hello</h1>
    <p class="static">Sub copy</p>
  </div>
  <div data-block-id="legacy" data-block-type="heading">
    <h2 data-editable-prop="text">Stored only</h2>
  </div>`;

describe("the canvas bridge draft overlay", () => {
  it("posts ready to the editor when the frame loads", () => {
    const { parentPost } = canvas(CANVAS_HTML);
    expect(parentPost).toHaveBeenCalledWith(
      { source: "freeholder-preview", ready: true },
      ORIGIN,
    );
  });

  it("lays the draft text over the typeable elements without a save round-trip", () => {
    const { window, document } = canvas(CANVAS_HTML);
    draftMessage(window, [
      { id: "h1", type: "heading", props: { text: "Hello world", level: 1 } },
      { id: "legacy", type: "heading", props: { text: "Stored only", level: 2 } },
    ]);
    const heading = document.querySelector('[data-block-id="h1"] [data-editable-prop="text"]');
    expect(heading?.textContent).toBe("Hello world");
    // Elements that are not typeable are left alone.
    expect(document.querySelector('[data-block-id="h1"] .static')?.textContent).toBe("Sub copy");
  });

  it("finds blocks nested in containers", () => {
    const { window, document } = canvas(CANVAS_HTML);
    draftMessage(window, [
      {
        id: "outer",
        type: "columns",
        props: {},
        children: [
          { id: "h1", type: "heading", props: { text: "Nested", level: 1 } },
        ],
      },
    ]);
    expect(
      document.querySelector('[data-block-id="h1"] [data-editable-prop="text"]')?.textContent,
    ).toBe("Nested");
  });

  it("leaves the element being typed into alone so the caret survives", () => {
    const { window, document } = canvas(CANVAS_HTML);
    const heading = document.querySelector('[data-block-id="h1"] [data-editable-prop="text"]')!;
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => heading,
    });
    draftMessage(window, [
      { id: "h1", type: "heading", props: { text: "Different", level: 1 } },
    ]);
    expect(heading.textContent).toBe("Hello");
    // Once focus moves away, the next draft applies.
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => document.body,
    });
    draftMessage(window, [
      { id: "h1", type: "heading", props: { text: "Committed", level: 1 } },
    ]);
    expect(heading.textContent).toBe("Committed");
  });

  it("ignores blocks the draft does not contain and coerces values to text", () => {
    const { window, document } = canvas(CANVAS_HTML);
    draftMessage(window, [
      { id: "h1", type: "heading", props: { text: 42, level: 1 } },
      // "legacy" is absent from the draft entirely — e.g. a section instance
      // whose children are not part of the edited tree.
    ]);
    expect(document.querySelector('[data-block-id="h1"] [data-editable-prop="text"]')?.textContent).toBe("42");
    expect(document.querySelector('[data-block-id="legacy"] [data-editable-prop="text"]')?.textContent).toBe("Stored only");
  });

  it("still traces clicks and editor selection after the draft branch", () => {
    const { window, document, parentPost } = canvas(CANVAS_HTML);
    const block = document.querySelector('[data-block-id="h1"]')!;
    block.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(parentPost).toHaveBeenCalledWith(
      { source: "freeholder-preview", blockId: "h1" },
      ORIGIN,
    );

    window.dispatchEvent(
      new window.MessageEvent("message", {
        origin: ORIGIN,
        data: { source: "freeholder-editor", blockId: "h1" },
      }),
    );
    expect(block.getAttribute("data-selected")).toBe("true");
  });

  it("ignores messages from another origin", () => {
    const { window, document } = canvas(CANVAS_HTML);
    window.dispatchEvent(
      new window.MessageEvent("message", {
        origin: "http://evil.example",
        data: { source: "freeholder-editor", draft: [{ id: "h1", type: "heading", props: { text: "Nope" } }] },
      }),
    );
    expect(document.querySelector('[data-block-id="h1"] [data-editable-prop="text"]')?.textContent).toBe("Hello");
  });
});
