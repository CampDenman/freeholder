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
// editor's *local draft* onto the typeable elements ([data-editable-prop],
// [data-editable-rich]) and the swappable assets ([data-asset-prop]) so a
// keystroke's preview never waits for the autosave debounce or a server
// round-trip. Entity props ([data-pick-prop] — a collection or product a
// commerce block renders) are reported as anchored pick requests instead;
// they repaint through the post-save reload, like a heading level. Anything
// the draft cannot express this way still reconverges when a save bumps the
// frame's version and it reloads from stored state.
export const CANVAS_BRIDGE = `
// Chromium defaults to <div> for Enter inside a contentEditable region; the
// typed rich document has paragraphs, so make the browser's own splits
// produce them. jsdom and Firefox simply ignore this.
try {
  if (document.execCommand) document.execCommand("defaultParagraphSeparator", false, "p");
} catch (e) {}

// The empty-image placeholder's label is copy, so it is server-rendered in the
// owner's language; the script only ever has to *rebuild* that placeholder.
var fhAssetEmptyLabel = null;
var fhFirstEmptyAsset = document.querySelector(".fh-asset-empty");
if (fhFirstEmptyAsset) fhAssetEmptyLabel = fhFirstEmptyAsset.textContent;

document.addEventListener("click", function (event) {
  var target = event.target instanceof Element ? event.target : null;
  if (target && target.closest("a")) event.preventDefault();
  var el = target ? target.closest("[data-block-id]") : null;
  var message = {
    source: "freeholder-preview",
    blockId: el ? el.getAttribute("data-block-id") : null
  };
  // The replace affordance on an image block: report which prop names the
  // asset and where the block sits, so the editor can anchor its picker.
  // x/y are physical viewport coordinates (getBoundingClientRect), consumed
  // by the picker's own direction-aware anchoring.
  var replace = target ? target.closest("[data-replace-asset]") : null;
  if (replace) {
    var host = replace.closest("[data-asset-prop]");
    var box = host ? host.getBoundingClientRect() : null;
    var pickX = 0, pickY = 0, pickW = 0, pickH = 0;
    if (box) {
      pickX = box.left;
      pickY = box.top;
      pickW = box.width;
      pickH = box.height;
    }
    message.assetPick = {
      prop: replace.getAttribute("data-replace-asset"),
      x: pickX,
      y: pickY,
      width: pickW,
      height: pickH
    };
  }
  // The entity-pick affordance on the commerce blocks (collection/product):
  // same anchored-picker message, different namespace. These are NOT media
  // assets — the draft cannot repaint them client-side, so unlike
  // data-asset-prop there is no fhApplyAsset pass for data-pick-prop; the
  // post-save frame reload reconciles the pick, like a heading level.
  var entityPick = target ? target.closest("[data-replace-pick]") : null;
  if (entityPick) {
    var pickHost = entityPick.closest("[data-pick-prop]");
    var pickBox = pickHost ? pickHost.getBoundingClientRect() : null;
    var entityX = 0, entityY = 0;
    if (pickBox) {
      entityX = pickBox.left;
      entityY = pickBox.top;
    }
    message.pick = {
      prop: entityPick.getAttribute("data-replace-pick"),
      x: entityX,
      y: entityY
    };
  }
  parent.postMessage(message, window.location.origin);
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
  if (!el) return;
  // A rich region is one editable surface over a typed document: paragraphs,
  // lists, links and marks. Typing anywhere inside it serializes the whole
  // region back to that document and reports it as the prop's value.
  var rich = el.closest("[data-editable-rich]");
  if (rich) {
    var richBlock = rich.closest("[data-block-id]");
    if (!richBlock) return;
    parent.postMessage({
      source: "freeholder-preview",
      edit: {
        blockId: richBlock.getAttribute("data-block-id"),
        prop: rich.getAttribute("data-editable-rich"),
        value: fhSerializeRich(rich)
      }
    }, window.location.origin);
    return;
  }
  if (!el.hasAttribute("data-editable-prop")) return;
  var block = el.closest("[data-block-id]");
  if (!block) return;
  parent.postMessage({
    source: "freeholder-preview",
    edit: {
      blockId: block.getAttribute("data-block-id"),
      // The prop may be a dotted path ("items.0.question") naming a value
      // inside an array prop; it travels opaquely to the editor either way.
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

// ── Rich regions: DOM ↔ typed document ────────────────────────────────────
//
// The typed document (paragraphs, bullet/ordered lists, text spans with
// strong/em/code marks, links) is what the renderer emitted; the serializers
// below are its mirror image, so a typed document round-trips through a
// contentEditable region losslessly for everything the vocabulary can say.
function fhInlineSpans(node, marks, into) {
  var children = node.childNodes;
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child.nodeType === 3) {
      var text = child.nodeValue;
      if (!text) continue;
      into.push(marks.length
        ? { type: "text", text: text, marks: marks.slice() }
        : { type: "text", text: text });
      continue;
    }
    if (child.nodeType !== 1) continue;
    var tag = child.tagName;
    // Pasted soup must never become executable: inert tags contribute nothing.
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "IFRAME") continue;
    // The typed document has no soft breaks; a <br> reads as a space.
    if (tag === "BR") {
      into.push({ type: "text", text: " " });
      continue;
    }
    if (tag === "A") {
      var linkChildren = [];
      fhInlineSpans(child, [], linkChildren);
      var href = child.getAttribute("href") || "#";
      into.push({
        type: "link",
        href: href,
        children: linkChildren.length ? linkChildren : [{ type: "text", text: href }]
      });
      continue;
    }
    var next = marks;
    if (tag === "STRONG" || tag === "B") next = marks.concat("strong");
    else if (tag === "EM" || tag === "I") next = marks.concat("em");
    else if (tag === "CODE") next = marks.concat("code");
    // Unknown inline elements (spans, fonts, pasted markup) flatten to their
    // text with the marks they sit inside.
    fhInlineSpans(child, next, into);
  }
}

// A rich region's children back to the typed document. <div> is treated as a
// paragraph on purpose: some browsers split paragraphs that way, and the
// document has no div block to keep it as.
function fhSerializeRich(container) {
  var blocks = [];
  var nodes = container.childNodes;
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node.nodeType === 3) {
      var stray = node.nodeValue ? node.nodeValue.trim() : "";
      if (stray) {
        blocks.push({ type: "paragraph", children: [{ type: "text", text: stray }] });
      }
      continue;
    }
    if (node.nodeType !== 1) continue;
    var tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "IFRAME") continue;
    if (tag === "UL" || tag === "OL") {
      var items = [];
      for (var j = 0; j < node.children.length; j++) {
        var li = node.children[j];
        if (li.tagName !== "LI") continue;
        var itemChildren = [];
        fhInlineSpans(li, [], itemChildren);
        if (!itemChildren.length) itemChildren.push({ type: "text", text: " " });
        items.push({ type: "listItem", children: itemChildren });
      }
      if (items.length) {
        blocks.push({ type: tag === "OL" ? "orderedList" : "bulletList", children: items });
      }
      continue;
    }
    var children = [];
    fhInlineSpans(node, [], children);
    if (!children.length) children.push({ type: "text", text: " " });
    blocks.push({ type: "paragraph", children: children });
  }
  // Deleting everything must still leave a document the schema accepts.
  if (!blocks.length) {
    blocks.push({ type: "paragraph", children: [{ type: "text", text: " " }] });
  }
  return blocks;
}

// The document a region currently shows, so a draft that matches it is a
// no-op: only a *different* document rebuilds the region, which is what keeps
// the caret alive while its own typing echoes back through the editor.
function fhApplyRich(el, doc) {
  var signature = JSON.stringify(doc);
  if (el.__fhRich === signature) return;
  el.__fhRich = signature;
  var fragment = document.createDocumentFragment();
  (doc || []).forEach(function (block) {
    fragment.appendChild(fhBuildBlock(block));
  });
  el.textContent = "";
  el.appendChild(fragment);
}

function fhAppendTextSpans(into, spans) {
  (spans || []).forEach(function (span) {
    var node = document.createTextNode(span.text || "");
    var marks = span.marks || [];
    // Same nesting as the server's markWrap: code innermost, em outermost.
    if (marks.indexOf("code") !== -1) { var code = document.createElement("code"); code.appendChild(node); node = code; }
    if (marks.indexOf("strong") !== -1) { var strong = document.createElement("strong"); strong.appendChild(node); node = strong; }
    if (marks.indexOf("em") !== -1) { var em = document.createElement("em"); em.appendChild(node); node = em; }
    into.appendChild(node);
  });
}

function fhAppendInlines(into, children) {
  (children || []).forEach(function (child) {
    if (child && child.type === "link") {
      var a = document.createElement("a");
      a.href = child.href || "#";
      fhAppendTextSpans(a, child.children || []);
      into.appendChild(a);
      return;
    }
    fhAppendTextSpans(into, [child]);
  });
}

function fhBuildBlock(block) {
  var node;
  if (block && (block.type === "bulletList" || block.type === "orderedList")) {
    node = document.createElement(block.type === "orderedList" ? "ol" : "ul");
    (block.children || []).forEach(function (item) {
      var li = document.createElement("li");
      fhAppendInlines(li, item.children || []);
      if (!li.childNodes.length) li.textContent = " ";
      node.appendChild(li);
    });
    return node;
  }
  node = document.createElement("p");
  fhAppendInlines(node, block ? block.children : null);
  if (!node.childNodes.length) node.textContent = " ";
  return node;
}

// ── Swappable assets ──────────────────────────────────────────────────────
//
// An image block's wrapper carries the asset id it rendered from
// (data-asset-current). When the draft names a different id, the new picture
// is resolved through the same public service the renderer used and painted
// immediately; the save that follows is only the reconciliation backstop.
function fhFetchAsset(id, done) {
  fetch("/api/v1/media.resolveImage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: id }),
    // No ambient credential: a public query needs no CSRF token, and the
    // frame's staff session is irrelevant to it.
    credentials: "omit"
  })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) { done(data && data.src ? data : null); })
    .catch(function () { done(null); });
}

function fhRenderAsset(body, data) {
  // Capture before clearing: rounding and width classes come from the server
  // render and survive onto the replacement picture.
  var previous = body.querySelector("img");
  var previousClass = previous ? previous.className : "";
  body.textContent = "";
  if (!data) {
    var empty = document.createElement("span");
    empty.className = "fh-asset-empty";
    empty.textContent = fhAssetEmptyLabel || "";
    body.appendChild(empty);
    return;
  }
  var picture = document.createElement("picture");
  (data.sources || []).forEach(function (source) {
    var el = document.createElement("source");
    el.setAttribute("srcset", source.srcset);
    el.setAttribute("type", source.type);
    picture.appendChild(el);
  });
  var img = document.createElement("img");
  img.src = data.src;
  img.alt = data.altText || "";
  if (data.width) img.width = data.width;
  if (data.height) img.height = data.height;
  img.loading = "lazy";
  img.decoding = "async";
  if (previousClass) img.className = previousClass;
  picture.appendChild(img);
  body.appendChild(picture);
}

function fhApplyAsset(el, assetId) {
  assetId = assetId || "";
  if (el.getAttribute("data-asset-current") === assetId) return;
  el.setAttribute("data-asset-current", assetId);
  var body = el.querySelector(":scope > .fh-asset-body");
  if (!body) return;
  if (!assetId) {
    fhRenderAsset(body, null);
    return;
  }
  fhFetchAsset(assetId, function (data) {
    // The draft may have moved on while the fetch was out; paint only what
    // is still current. A failed resolve leaves the old picture for the
    // post-save reload to reconcile.
    if (el.getAttribute("data-asset-current") !== assetId) return;
    if (data) fhRenderAsset(body, data);
  });
}

// ── Order reconciliation ──────────────────────────────────────────────────
//
// The draft broadcast carries the whole tree, order included. The frame
// renders *stored* state, so a reorder the editor just made (a canvas drop,
// a grip keypress, a form-panel button) has no reflection in the DOM until a
// save reloads the frame — unless the draft puts the DOM back in step itself.
// That is what this does, one parent level at a time, moving the block
// wrappers the draft names and nothing else.
//
// Two deliberate conservatisms keep it honest:
//
// - A level whose wrapper count differs from the draft's node count is left
//   alone. A fresh block or a removed one has no (or a stale) wrapper here;
//   the post-save reload is the reconciliation backstop for those, exactly as
//   it is for values the draft cannot express.
// - A level the owner is currently typing inside is left alone:
//   re-appending ancestors mid-sentence would throw the caret away.
function fhDirectChildren(container, isRoot) {
  var out = [];
  var descendants = container.querySelectorAll("[data-block-id]");
  for (var i = 0; i < descendants.length; i++) {
    var el = descendants[i];
    var parentBlock = el.parentElement
      ? el.parentElement.closest("[data-block-id]")
      : null;
    if ((isRoot && parentBlock === null) || (!isRoot && parentBlock === container)) {
      out.push(el);
    }
  }
  return out;
}

function fhReorderLevel(container, draftNodes, isRoot) {  if (!draftNodes || draftNodes.length === 0) return;
  var active = document.activeElement;
  var typing =
    active &&
    active !== document.body &&
    container.contains(active) &&
    active.closest &&
    active.closest("[data-editable-prop], [data-editable-rich]");
  var domChildren = fhDirectChildren(container, isRoot);
  var byId = {};
  for (var j = 0; j < domChildren.length; j++) {
    byId[domChildren[j].getAttribute("data-block-id")] = domChildren[j];
  }
  if (!typing && domChildren.length > 0 && domChildren.length === draftNodes.length) {
    var parent = domChildren[0].parentNode;
    var singleParent = true;
    for (var i = 1; i < domChildren.length; i++) {
      if (domChildren[i].parentNode !== parent) {
        singleParent = false;
        break;
      }
    }
    // appendChild on an already-present node moves it, so walking the draft
    // order re-sorts the level without recreating anything — the elements
    // keep their identity, which is what keeps focus and selection intact.
    if (singleParent) {
      for (var k = 0; k < draftNodes.length; k++) {
        var el = byId[draftNodes[k].id];
        if (el) parent.appendChild(el);
      }
    }
  }
  // A level the owner is typing into keeps its order; levels the caret is
  // not in still re-sort.
  for (var m = 0; m < draftNodes.length; m++) {
    var child = byId[draftNodes[m].id];
    if (child && draftNodes[m].children) {
      fhReorderLevel(child, draftNodes[m].children, false);
    }
  }
}

// The editor's local draft, applied straight onto the typeable elements.
//
// The frame renders stored state; the editor broadcasts its draft tree after
// every change (rAF-throttled), and this lays the draft's values over
// whichever elements the blocks marked editable. Elements are looked up from
// the DOM — only a block knows which of its props is typeable, and it said so
// through data-editable-prop / data-editable-rich when it rendered — so no
// second rendering of blocks exists anywhere.
function fhApplyDraft(draft) {
  var byId = {};
  var index = function (nodes) {
    (nodes || []).forEach(function (node) {
      if (node && typeof node.id === "string") byId[node.id] = node;
      if (node && node.children) index(node.children);
    });
  };
  index(Array.isArray(draft) ? draft : draft && draft.blocks);

  // Plain text props — including dotted paths into array props.
  document.querySelectorAll("[data-editable-prop]").forEach(function (el) {
    // The element being typed into already shows its own text; rewriting it
    // would throw the caret away.
    if (el === document.activeElement) return;
    var block = el.closest("[data-block-id]");
    if (!block) return;
    var node = byId[block.getAttribute("data-block-id")];
    if (!node || !node.props) return;
    var value = node.props;
    var keys = String(el.getAttribute("data-editable-prop")).split(".");
    for (var i = 0; i < keys.length && value !== undefined && value !== null; i++) {
      value = value[keys[i]];
    }
    if (value === undefined || value === null) value = "";
    value = String(value);
    if (el.textContent !== value) el.textContent = value;
  });

  // Rich regions: a matching document is a no-op, a different one rebuilds.
  document.querySelectorAll("[data-editable-rich]").forEach(function (el) {
    if (el.contains(document.activeElement)) return;
    var block = el.closest("[data-block-id]");
    if (!block) return;
    var node = byId[block.getAttribute("data-block-id")];
    if (!node || !node.props) return;
    var doc = node.props[el.getAttribute("data-editable-rich")];
    fhApplyRich(el, Array.isArray(doc) ? doc : []);
  });

  // Swappable assets.
  document.querySelectorAll("[data-asset-prop]").forEach(function (el) {
    var block = el.closest("[data-block-id]");
    if (!block) return;
    var node = byId[block.getAttribute("data-block-id")];
    if (!node || !node.props) return;
    var assetId = node.props[el.getAttribute("data-asset-prop")];
    fhApplyAsset(el, typeof assetId === "string" ? assetId : "");
  });

  // Order: the draft's tree is the sequence the owner sees in the form
  // panel; the canvas agrees as soon as the broadcast lands, without
  // waiting for the post-save reload. Typing broadcasts constantly without
  // ever changing the order, so the re-sort — the only pass here that moves
  // DOM nodes — runs solely when the shape actually differs from what the
  // canvas last applied.
  var draftNodes = Array.isArray(draft) ? draft : draft && draft.blocks;
  var signature = JSON.stringify(fhOrderShape(draftNodes));
  if (signature !== fhOrderSignature) {
    fhOrderSignature = signature;
    var root = document.querySelector(".fh-canvas") || document.body;
    fhReorderLevel(root, draftNodes, true);
  }
}

// The nested id shape of a draft, in a string one broadcast can compare
// against the last one it applied.
var fhOrderSignature = null;
function fhOrderShape(nodes) {
  var out = [];
  (nodes || []).forEach(function (node) {
    if (node && typeof node.id === "string") {
      out.push(
        node.children && node.children.length
          ? [node.id, fhOrderShape(node.children)]
          : node.id,
      );
    }
  });
  return out;
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

/**
 * The drag-and-drop half of the canvas script: grips, ghost, drop indicators
 * and the keyboard path. Kept beside {@link CANVAS_BRIDGE} as an exported
 * string so the test suite evaluates exactly what the frame ships.
 *
 * The frame never moves blocks itself. A drop (or a grip keypress) posts an
 * *intent* to the editor; the editor decides whether it is legal, applies it
 * to the tree, and the next draft broadcast re-sorts this DOM. A refused or
 * cancelled drop therefore simply never lands — the canvas cannot be left
 * showing an order the tree does not hold. Escape ends a native drag with a
 * plain dragend, which cleans up exactly like a drop outside every zone.
 *
 * The script reads three injected label constants (serialized in the preview
 * layout, so they render in the owner's language): FH_DRAG_LABEL names the
 * grip; FH_ANNOUNCE_UP / FH_ANNOUNCE_DOWN / FH_ANNOUNCE_MOVE feed the live
 * region that confirms a move to a screen reader.
 */
export const CANVAS_DRAG = `
// ── Dragging blocks around the canvas ─────────────────────────────────────
//
// A grip rather than making the whole block draggable: a draggable element
// swallows text selection, and half these blocks are typed into. The grip is
// a real <button> injected here rather than emitted by the renderer, so the
// block components stay free of editor furniture and the affordance is
// focusable and keyboard-operable on its own (§15.7).
var fhLive = null;
function fhAnnounce(text) {
  if (!fhLive) {
    fhLive = document.createElement("div");
    fhLive.className = "fh-sr-only";
    fhLive.setAttribute("role", "status");
    fhLive.setAttribute("aria-live", "polite");
    document.body.appendChild(fhLive);
  }
  // Clearing first makes two identical moves in a row announce twice.
  fhLive.textContent = "";
  window.setTimeout(function () {
    fhLive.textContent = text;
  }, 30);
}

function fhAddGrips() {
  document.querySelectorAll("[data-block-id]").forEach(function (block) {
    // The drag ghost is a clone of a rendered block; it is a drag image, not
    // a live surface, and gets no furniture of its own.
    if (block.closest(".fh-ghost")) return;
    if (block.querySelector(":scope > .fh-grip")) return;
    var grip = document.createElement("button");
    grip.type = "button";
    grip.className = "fh-grip";
    grip.setAttribute("draggable", "true");
    grip.setAttribute("aria-label", FH_DRAG_LABEL);
    grip.title = FH_DRAG_LABEL;
    // A six-dot SVG rather than a braille glyph: the accessible name comes
    // from the label, and a text node invites axe's indeterminate
    // color-contrast heuristic on a one-character string.
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 10 16");
    svg.setAttribute("width", "10");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 2; col++) {
        var dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", String(2.5 + col * 5));
        dot.setAttribute("cy", String(3 + row * 5));
        dot.setAttribute("r", "1.4");
        dot.setAttribute("fill", "currentColor");
        svg.appendChild(dot);
      }
    }
    grip.appendChild(svg);
    block.appendChild(grip);
  });
}
fhAddGrips();
new MutationObserver(fhAddGrips).observe(document.body, {
  childList: true,
  subtree: true
});

// The sibling block at the same nesting level, skipping any non-block
// element a container renders between its children (a variant's caption, say).
function fhSiblingBlock(block, direction) {
  var el = direction < 0
    ? block.previousElementSibling
    : block.nextElementSibling;
  while (el && !el.hasAttribute("data-block-id")) {
    el = direction < 0
      ? el.previousElementSibling
      : el.nextElementSibling;
  }
  return el;
}

// Keyboard reordering from the canvas: focus a block's grip and press an
// arrow key. The move is reported as the same intent a drop posts (beside
// the adjacent sibling), so the editor applies it through the same tree
// surgery, and the in-frame live region confirms it where focus already is.
document.addEventListener("keydown", function (event) {
  var grip = event.target instanceof Element ? event.target : null;
  if (!grip || !grip.classList || !grip.classList.contains("fh-grip")) return;
  var direction = 0;
  if (event.key === "ArrowUp") direction = -1;
  if (event.key === "ArrowDown") direction = 1;
  if (!direction) return;
  event.preventDefault();
  var block = grip.closest("[data-block-id]");
  if (!block) return;
  var sibling = fhSiblingBlock(block, direction);
  if (!sibling) return; // already at the edge of this level
  parent.postMessage({
    source: "freeholder-preview",
    move: {
      blockId: block.getAttribute("data-block-id"),
      targetId: sibling.getAttribute("data-block-id"),
      position: direction < 0 ? "before" : "after"
    }
  }, window.location.origin);
  fhAnnounce(direction < 0 ? FH_ANNOUNCE_UP : FH_ANNOUNCE_DOWN);
});

var fhDragId = null;
var fhDrop = null;
var fhGhost = null;

function fhClearIndicator() {
  document.querySelectorAll("[data-drop]").forEach(function (n) {
    n.removeAttribute("data-drop");
  });
}

// The translucent, live-sized preview that follows the pointer. The native
// drag image is this element: built from the dragged block's own render, so
// the ghost shows exactly what is being moved, at its real width.
function fhLiftGhost(block, event) {
  var ghost = block.cloneNode(true);
  ghost.removeAttribute("data-dragging");
  ghost.removeAttribute("data-selected");
  var grip = ghost.querySelector(":scope > .fh-grip");
  if (grip && grip.parentNode) grip.parentNode.removeChild(grip);
  ghost.className = (ghost.className ? ghost.className + " " : "") + "fh-ghost";
  var box = block.getBoundingClientRect();
  ghost.style.width = box.width + "px";
  document.body.appendChild(ghost);
  if (event.dataTransfer && event.dataTransfer.setDragImage) {
    event.dataTransfer.setDragImage(
      ghost,
      event.clientX - box.left,
      event.clientY - box.top
    );
  }
  return ghost;
}

document.addEventListener("dragstart", function (event) {
  var target = event.target instanceof Element ? event.target : null;
  if (!target || !target.classList.contains("fh-grip")) return;
  var block = target.closest("[data-block-id]");
  if (!block) return;
  fhDragId = block.getAttribute("data-block-id");
  block.setAttribute("data-dragging", "true");
  fhGhost = fhLiftGhost(block, event);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag without data on the transfer.
    event.dataTransfer.setData("text/plain", fhDragId);
  }
});

document.addEventListener("dragover", function (event) {
  if (!fhDragId) return;
  event.preventDefault();
  var target = event.target instanceof Element ? event.target : null;
  var block = target ? target.closest("[data-block-id]") : null;
  fhClearIndicator();
  if (!block) { fhDrop = null; return; }

  var id = block.getAttribute("data-block-id");
  if (id === fhDragId) { fhDrop = null; return; }

  var box = block.getBoundingClientRect();
  var container = block.querySelector(":scope > * > [data-block-id]") !== null
    || block.hasAttribute("data-container");
  var empty = container && block.querySelector("[data-block-id]") === null;

  var position;
  if (empty) {
    position = "inside";
  } else {
    position = event.clientY < box.top + box.height / 2 ? "before" : "after";
  }
  block.setAttribute("data-drop", position);
  fhDrop = { targetId: id, position: position };
});

document.addEventListener("drop", function (event) {
  if (!fhDragId || !fhDrop) return;
  event.preventDefault();
  parent.postMessage({
    source: "freeholder-preview",
    move: {
      blockId: fhDragId,
      targetId: fhDrop.targetId,
      position: fhDrop.position
    }
  }, window.location.origin);
  fhAnnounce(FH_ANNOUNCE_MOVE);
  // The DOM is deliberately left alone. The editor applies the move to the
  // tree, the draft broadcast re-sorts this DOM, and a drop the editor
  // refuses simply never lands — dropping outside a zone or pressing Escape
  // leaves the page untouched, which is what makes the drop confident.
});

document.addEventListener("dragend", function () {
  fhDragId = null;
  fhDrop = null;
  fhClearIndicator();
  document.querySelectorAll("[data-dragging]").forEach(function (n) {
    n.removeAttribute("data-dragging");
  });
  if (fhGhost && fhGhost.parentNode) fhGhost.parentNode.removeChild(fhGhost);
  fhGhost = null;
});
`;
