---
"freeholder": patch
---

Stored images are checked by their contents before any resizing, cropping,
watermarking or social preparation, so an SVG kept from before SVG uploads
were refused is never processed as a picture, whatever its file type label
says. Rescanning such a file no longer fails: it keeps its scan result, is
left unchanged, and the rescan explains why no resized copies were made.
Preparing one for social accounts is refused by name. JPEG, PNG, GIF, WebP
and AVIF images work as before.
