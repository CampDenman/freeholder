// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The script the editor canvas frame runs (MASTER.md §32's "live responsive
// preview").
//
// Kept as an exported string, separate from the preview layout, so the test
// suite evaluates the very script the frame ships rather than a copy of it.
// The script is plain ES5-ish browser JS on purpose: it runs inline under the
// page's CSP nonce, with no build step and no imports.
//
// The frame renders the *stored* tree server-side; this script layers the
// editor's *local draft* onto the typeable elements ([data-editable-prop])
// so a keystroke's preview never waits for the autosave debounce or a server
// round-trip. Anything the draft cannot express this way (a heading level, a
// new block) still reconverges when a save bumps the frame's version and it
// reloads from stored state.
export const CANVAS_BRIDGE = `
document.addEventListener("click", function (event) {
  var target = event.target instanceof Element ? event.target : null;
  if (target && target.closest("a")) event.preventDefault();
  var el = target ? target.closest("[data-block-id]") : null;
  parent.postMessage({
    source: "freeholder-preview",
    blockId: el ? el.getAttribute("data-block-id") : null
  }, window.location.origin);
});
document.addEventListener("mouseover", function (event) {
  var target = event.target instanceof Element ? event.target : null;
  var el = target ? target.closest("[data-block-id]") : null;
  document.querySelectorAll("[data-hovered]").forEach(function (n) {
    n.removeAttribute("data-hovered");
  });
  if (el) el.setAttribute("data-hovered", "true");
});
// Typing on the canvas. The element carries which prop it shows and the block
// it belongs to; the editor owns the tree and decides what to do with it.
//
// Listens on input rather than blur, so the controls stay in step while
// typing. The canvas never writes to the tree itself; it only reports what was
// typed, and the editor debounces before saving.
document.addEventListener("input", function (event) {
  var el = event.target instanceof Element ? event.target : null;
  if (!el || !el.hasAttribute("data-editable-prop")) return;
  var block = el.closest("[data-block-id]");
  if (!block) return;
  parent.postMessage({
    source: "freeholder-preview",
    edit: {
      blockId: block.getAttribute("data-block-id"),
      prop: el.getAttribute("data-editable-prop"),
      value: el.innerText
    }
  }, window.location.origin);
});

// Enter would insert a line break inside a heading; blur commits instead.
document.addEventListener("keydown", function (event) {
  var el = event.target instanceof Element ? event.target : null;
  if (!el || !el.hasAttribute("data-editable-prop")) return;
  if (event.key === "Enter" && el.tagName !== "DIV") {
    event.preventDefault();
    el.blur();
  }
});

// The editor's local draft, applied straight onto the typeable elements.
//
// The frame renders stored state; the editor broadcasts its draft tree after
// every change (rAF-throttled), and this lays the draft's text over whichever
// elements the blocks marked editable. Elements are looked up from the DOM —
// only a block knows which of its props is typeable, and it said so through
// data-editable-prop when it rendered — so no second rendering of blocks
// exists anywhere. The draft value is plain text, exactly what the server
// render put in these elements, so textContent is both the comparison and
// the write.
function fhApplyDraft(draft) {
  var byId = {};
  var index = function (nodes) {
    (nodes || []).forEach(function (node) {
      if (node && typeof node.id === "string") byId[node.id] = node;
      if (node && node.children) index(node.children);
    });
  };
  index(Array.isArray(draft) ? draft : draft && draft.blocks);
  document.querySelectorAll("[data-editable-prop]").forEach(function (el) {
    // The element being typed into already shows its own text; rewriting it
    // would throw the caret away.
    if (el === document.activeElement) return;
    var block = el.closest("[data-block-id]");
    if (!block) return;
    var node = byId[block.getAttribute("data-block-id")];
    if (!node || !node.props) return;
    var value = node.props[el.getAttribute("data-editable-prop")];
    if (value === undefined || value === null) value = "";
    value = String(value);
    if (el.textContent !== value) el.textContent = value;
  });
}

window.addEventListener("message", function (event) {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.source !== "freeholder-editor") return;
  if (event.data.draft) {
    fhApplyDraft(event.data.draft);
    return;
  }
  document.querySelectorAll("[data-selected]").forEach(function (n) {
    n.removeAttribute("data-selected");
  });
  if (!event.data.blockId) return;
  var el = document.querySelector('[data-block-id="' + event.data.blockId + '"]');
  if (el) {
    el.setAttribute("data-selected", "true");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
});

// The frame has (re)loaded — after a save bumps its version, for instance.
// Ask the editor for the current draft so typing that raced the reload is
// not lost; the first load simply receives a no-op draft.
parent.postMessage({ source: "freeholder-preview", ready: true }, window.location.origin);
`;
