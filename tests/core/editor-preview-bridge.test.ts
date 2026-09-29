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

const RICH_HTML = `
  <div data-block-id="t1" data-block-type="text">
    <div data-editable-rich="body"><p>Hello <strong>bold</strong> <a href="/about">world</a></p><ul><li>One</li><li>Two</li></ul></div>
  </div>`;

const FAQ_HTML = `
  <div data-block-id="f1" data-block-type="faq">
    <dl><div><dt data-editable-prop="items.0.question">Q?</dt><dd data-editable-prop="items.0.answer">A.</dd></div></dl>
  </div>`;

const IMAGE_HTML = `
  <div data-block-id="i1" data-block-type="image">
    <div class="fh-asset" data-asset-prop="assetId" data-asset-current="aaaaaaaa-0000-4000-8000-000000000001">
      <div class="fh-asset-body"><picture><img src="/media/old.jpg" alt="Old" width="800" height="600" class="rounded-lg"></picture></div>
      <button type="button" class="fh-replace" data-replace-asset="assetId">Replace image</button>
    </div>
  </div>`;

const EMPTY_IMAGE_HTML = `
  <div data-block-id="i2" data-block-type="image">
    <div class="fh-asset" data-asset-prop="assetId" data-asset-current="">
      <div class="fh-asset-body"><span class="fh-asset-empty">No image chosen</span></div>
      <button type="button" class="fh-replace" data-replace-asset="assetId">Replace image</button>
    </div>
  </div>`;

function inputEvent(window: JSDOM["window"], el: Element) {
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

describe("the canvas bridge rich regions", () => {
  it("serializes typing back to the typed document, keeping marks, links and lists", () => {
    const { window, document, parentPost } = canvas(RICH_HTML);
    const paragraph = document.querySelector('[data-block-id="t1"] p')!;
    paragraph.childNodes[0]!.textContent = "Hi ";
    inputEvent(window, paragraph);

    const edit = parentPost.mock.calls
      .map((call) => call[0] as { edit?: { blockId?: string; prop?: string; value?: unknown } })
      .map((message) => message.edit)
      .find(Boolean);
    expect(edit).toMatchObject({ blockId: "t1", prop: "body" });
    expect(edit?.value).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Hi " },
          { type: "text", text: "bold", marks: ["strong"] },
          { type: "text", text: " " },
          { type: "link", href: "/about", children: [{ type: "text", text: "world" }] },
        ],
      },
      {
        type: "bulletList",
        children: [
          { type: "listItem", children: [{ type: "text", text: "One" }] },
          { type: "listItem", children: [{ type: "text", text: "Two" }] },
        ],
      },
    ]);
  });

  it("normalizes a browser div split and an emptied region into schema-shaped paragraphs", () => {
    const { window, document, parentPost } = canvas(`
      <div data-block-id="t1" data-block-type="text">
        <div data-editable-rich="body"><div>First</div><div><br></div></div>
      </div>`);
    inputEvent(window, document.querySelector('[data-block-id="t1"] [data-editable-rich]')!);
    const edit = parentPost.mock.calls.at(-1)?.[0] as { edit?: { value?: unknown } };
    expect(edit.edit?.value).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "First" }] },
      { type: "paragraph", children: [{ type: "text", text: " " }] },
    ]);

    const emptied = canvas(`
      <div data-block-id="t2" data-block-type="text">
        <div data-editable-rich="body"></div>
      </div>`);
    inputEvent(emptied.window, emptied.document.querySelector('[data-editable-rich]')!);
    const emptyEdit = emptied.parentPost.mock.calls.at(-1)?.[0] as { edit?: { value?: unknown } };
    expect(emptyEdit.edit?.value).toEqual([
      { type: "paragraph", children: [{ type: "text", text: " " }] },
    ]);
  });

  it("rebuilds a rich region from a different draft document", () => {
    const { window, document } = canvas(RICH_HTML);
    draftMessage(window, [
      {
        id: "t1",
        type: "text",
        props: {
          body: [
            { type: "paragraph", children: [{ type: "text", text: "Replaced" }] },
            {
              type: "orderedList",
              children: [{ type: "listItem", children: [{ type: "text", text: "One", marks: ["em"] }] }],
            },
          ],
        },
      },
    ]);
    const region = document.querySelector('[data-editable-rich]')!;
    expect(region.querySelector("p")?.textContent).toBe("Replaced");
    expect(region.querySelector("ol li em")?.textContent).toBe("One");
    expect(region.querySelector("ul")).toBeNull();
  });

  it("leaves the region alone while it holds the caret, and when the document matches", () => {
    const { window, document } = canvas(RICH_HTML);
    const region = document.querySelector('[data-editable-rich]')!;
    const doc = [
      { type: "paragraph", children: [{ type: "text", text: "Other" }] },
    ];
    // Focused: the owner's own typing echoes back — rebuilding would evict the caret.
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => region.querySelector("p"),
    });
    draftMessage(window, [{ id: "t1", type: "text", props: { body: doc } }]);
    expect(region.querySelector("p")?.textContent).toBe("Hello bold world");

    // Blurred: the next draft applies, and a matching one never rebuilds.
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      get: () => document.body,
    });
    draftMessage(window, [{ id: "t1", type: "text", props: { body: doc } }]);
    expect(region.querySelector("p")?.textContent).toBe("Other");
    region.querySelector("p")!.setAttribute("data-marker", "kept");
    draftMessage(window, [{ id: "t1", type: "text", props: { body: doc } }]);
    expect(region.querySelector("p")?.getAttribute("data-marker")).toBe("kept");
  });
});

describe("the canvas bridge array-prop paths", () => {
  it("applies a draft value through a dotted path into an array prop", () => {
    const { window, document } = canvas(FAQ_HTML);
    draftMessage(window, [
      { id: "f1", type: "faq", props: { items: [{ question: "New question?", answer: "A." }] } },
    ]);
    expect(document.querySelector('[data-editable-prop="items.0.question"]')?.textContent).toBe(
      "New question?",
    );
    expect(document.querySelector('[data-editable-prop="items.0.answer"]')?.textContent).toBe("A.");
  });
});

describe("the canvas bridge image replace", () => {
  it("reports the pick intent with the block, the prop and the anchor box", () => {
    const { window, document, parentPost } = canvas(IMAGE_HTML);
    document.querySelector<HTMLButtonElement>(".fh-replace")!.click();
    expect(parentPost).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "freeholder-preview",
        blockId: "i1",
        assetPick: { prop: "assetId", x: 0, y: 0, width: 0, height: 0 },
      }),
      ORIGIN,
    );
    // jsdom has no layout; the shape above is what a real frame fills in.
    void window;
  });

  it("swaps the picture optimistically when the draft names a new asset", async () => {
    const { window, document } = canvas(IMAGE_HTML);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          src: "/media/new.jpg",
          sources: [{ format: "avif", srcset: "/media/new.avif 800w", type: "image/avif" }],
          width: 1024,
          height: 768,
          altText: "New picture",
        }),
    });
    Object.defineProperty(window, "fetch", { configurable: true, value: fetchMock });

    draftMessage(window, [
      { id: "i1", type: "image", props: { assetId: "bbbbbbbb-1111-4222-8333-000000000002" } },
    ]);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/media.resolveImage",
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
    const img = document.querySelector<HTMLImageElement>(".fh-asset-body img")!;
    expect(img.getAttribute("src")).toBe("/media/new.jpg");
    expect(img.getAttribute("alt")).toBe("New picture");
    // The server render's classes (rounding, width) survive the swap.
    expect(img.className).toBe("rounded-lg");
    expect(document.querySelector(".fh-asset-body source")?.getAttribute("srcset")).toBe(
      "/media/new.avif 800w",
    );
  });

  it("shows the placeholder when the asset is cleared, and keeps the picture when a resolve fails", async () => {
    const { window, document } = canvas(IMAGE_HTML);
    draftMessage(window, [{ id: "i1", type: "image", props: {} }]);
    await flushMicrotasks();
    expect(document.querySelector(".fh-asset-body .fh-asset-empty")).not.toBeNull();
    expect(document.querySelector(".fh-asset-body img")).toBeNull();

    const failing = canvas(EMPTY_IMAGE_HTML);
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    Object.defineProperty(failing.window, "fetch", { configurable: true, value: fetchMock });
    draftMessage(failing.window, [
      { id: "i2", type: "image", props: { assetId: "cccccccc-2222-4333-8444-000000000003" } },
    ]);
    await flushMicrotasks();
    // No picture to keep here; the failed resolve must not paint an empty box
    // over a still-pending state — the placeholder stays for the post-save
    // reload to reconcile.
    expect(failing.document.querySelector(".fh-asset-body .fh-asset-empty")).not.toBeNull();
    expect(failing.document.querySelector(".fh-asset-body img")).toBeNull();
  });

  it("resolves the picked asset for an image block that had none", async () => {
    const { window, document } = canvas(EMPTY_IMAGE_HTML);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ src: "/media/first.jpg", sources: [], width: null, height: null, altText: null }),
    });
    Object.defineProperty(window, "fetch", { configurable: true, value: fetchMock });
    draftMessage(window, [
      { id: "i2", type: "image", props: { assetId: "dddddddd-3333-4444-8555-000000000004" } },
    ]);
    await flushMicrotasks();
    expect(document.querySelector<HTMLImageElement>(".fh-asset-body img")?.getAttribute("src")).toBe(
      "/media/first.jpg",
    );
  });
});
