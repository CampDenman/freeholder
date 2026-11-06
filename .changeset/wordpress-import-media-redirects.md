---
"freeholder": minor
---

Bring a WordPress site across with its pictures, dates and old links intact.

Upload the export file from WordPress (Tools → Export) in the import studio and
Freeholder now reads far more of it. Posts land as blog posts under `/blog`
with their original publication dates, so they appear in your blog listing in
the right order. Pages keep their WordPress paths. The images and files in your
WordPress media library are downloaded into your Freeholder library, safely and
within size and type limits, with their alt text and smaller AVIF and WebP
versions, and the pictures in each post point at the new copies. Titles and
descriptions you set in Yoast or Rank Math become each page's SEO title and
description. Old addresses that changed, like `/2025/03/my-post/`, redirect to
the new ones, so shared links and search results keep working. Your main
WordPress menu joins your site navigation when you publish.

Text arrives as ordinary editable blocks (headings, paragraphs, lists,
pictures and galleries) rather than one block of raw HTML.

Some things are not recreated, and the import report says so: categories,
tags and authors are listed but not attached to posts, because Freeholder's
blog has no categories or authors yet; reader comments are not imported; nested
menu items are not added. Export files over 1 MB cannot be uploaded yet.

Everything is still a draft until you approve publishing, and rolling the
import back removes the pages, redirects, menu links and imported files again.
