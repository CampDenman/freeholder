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
// round-trip. Anything the draft cannot express this way (a heading level, a
// new block) still reconverges when a save bumps the frame's version and it
// reloads from stored state.
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
  var replace = target ? target.closest("[data-replace-asset]") : null;
  if (replace) {
    var host = replace.closest("[data-asset-prop]");
    var box = host ? host.getBoundingClientRect() : null;
    message.assetPick = {
      prop: replace.getAttribute("data-replace-asset"),
      top: box ? box.top : 0,
      left: box ? box.left : 0,
      width: box ? box.width : 0,
      height: box ? box.height : 0
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
    el.srcSet = source.srcset;
    el.type = source.type;
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
