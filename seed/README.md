# seed/ — the demo business

**Aurora Coast Photography**: a fictional one-person photography studio in the
Comox Valley, and the site a fresh Freeholder can fill itself with.

It exists for three reasons, and all three want it to be *good* rather than
merely present:

- **§15.2's SEO gate crawls it.** A demo site that fails the doctrine cannot be
  used to prove the doctrine holds, so the gate would be checking nothing.
- **§25's plugin dev harness boots it.** This is the site a contributor sees
  first, and the one they form an idea of the platform from.
- **§3 promises "a fresh deploy is instantly explorable."** An empty instance
  is a tutorial. A populated one is a product.

## What is here

```
seed/
└── demo/
    └── content.ts     # the business, the pages, the copy, the images
```

Content only. The installer is a service — `demo.install`, in
`src/modules/seed/` — because everything it writes goes through the ordinary
services, so the demo can only contain content an owner could have produced by
hand. If the seed ever needs a table write the service layer forbids, either
the seed is wrong or the service layer is.

## Installing it

```sh
# A deploy that arrives populated. Read once at boot; refuses if the site
# already has pages, and there is no route that can trigger it.
FREEHOLDER_SEED_DEMO=1
```

…or call `demo.install` as the owner from the admin, the API, or MCP — one
implementation, whichever door it is reached through (§2 principle 7).

## Editing the copy

`content.ts` is data. Change a page's words, add a page, reorder the nav —
none of that is a change to behaviour. But `tests/core/seed-demo.test.ts`
asserts the *shape* of it, and will fail if an edit breaks the doctrine the
demo exists to demonstrate:

- every page within three hops of the root (§5's RIBA rule)
- exactly one H1 per page
- a unique title and description on every page, within the lengths search
  results actually truncate at
- alt text on every image that describes the picture rather than naming the file
- no button linking to a page that does not exist

That list is the checkable half of §5, asserted against the content directly —
where a failure names the page, rather than in a crawler where it names a URL.

## The images

Generated at install time from SVG gradients, not committed as photographs.
Real images would be somebody's copyright, tens of megabytes in a repository
that has to stay cloneable, and a licence question on every fork. The generated
ones still exercise everything that matters: sharp reads them, renditions are
built at every width, `<picture>` gets real AVIF and WebP sources, and pages
reserve intrinsic dimensions so nothing reflows when they land.

## Still owed

Modules do not yet contribute their own seed data through their manifests
(§11). When commerce and booking exist, this becomes a registry of
per-module seeds rather than one file — and the one-click purge from admin
lands with it.
