---
"freeholder": patch
---

Stored images are checked by their contents before any resizing, cropping,
watermarking or social preparation, so an SVG kept from before SVG uploads
were refused is never processed as a picture, whatever its file type label
says. Rescanning such a file no longer fails: it keeps its scan result, is
left unchanged, and the rescan explains why no resized copies were made.
Stored videos are likewise checked before a social clip is made: only MP4,
QuickTime and WebM contents are processed, each read as exactly that format
and from the stored file alone, so a playlist saved under a video label can
no longer make the video tool open other files or web addresses. Preparing a
post for social accounts checks every file first and refuses an unsupported
one by name before anything is made. JPEG, PNG, GIF, WebP and AVIF images
and MP4, QuickTime and WebM videos work as before.
