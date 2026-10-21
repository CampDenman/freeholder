---
"freeholder": minor
---

Blocks move on the canvas itself, the way the page will actually ship them. In the page editor every block shows a drag handle on hover and keyboard focus: dragging lifts a translucent, live-sized copy of the block that follows the pointer, a line between blocks (or a highlighted nest zone inside a container) shows exactly where it will land, and Escape — or dropping outside a valid spot — changes nothing. Arrow keys on a focused handle reorder the same way, and every move is announced to screen readers. The canvas, the form panel and the saved draft stay in the same order without waiting for a frame reload, and a published page gets a single "Publish changes" action that updates the live site without unpublishing it first.
