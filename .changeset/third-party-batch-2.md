---
"freeholder": patch
---

More fixes from the third-party reports:

- The web manifest named the platform, not the business, so a customer who added
  a site to their phone's home screen saw "Freeholder" under the icon. It now
  reads the business name, and uses the logo from the design theme as the app
  icon when one is set.
- There was no not-found route, so a mistyped address rendered an empty body
  inside the site's own layout. There is now a 404 page in every shipped locale.
- `llms.txt` described a Canadian business as being based in "CA", which reads as
  California to an answer engine. It uses the country's name.
- Text controls are 16px rather than 14px. iOS Safari zooms the whole page when a
  control under 16px takes focus, so every phone visitor's first tap into a field
  shifted the page. Reported against the public enquiry form; the shared control
  is every text field in the admin and portal too, so it is fixed at the source.
- `onDanger` is settable. It was checked for contrast but absent from the patch
  schema, so a site sending a light palette for the dark slot was refused over a
  role it had never been allowed to send — and the message named that role.
- A nav block can opt out of collapsing behind a phone menu, which hid every
  footer link on mobile, and there are now footer and secondary labels so two
  navs no longer announce themselves identically.
- `cms.ensureDefaults` names the stale section instead of answering 500. An
  upgrade that removes a block type made header and footer maintenance fail with
  nothing to act on. The refusal itself is unchanged: silently dropping an
  unknown block is how an owner loses a section permanently.
