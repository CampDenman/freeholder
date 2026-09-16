---
"freeholder": minor
---

Arabic ships as a complete UI catalog. All 6,340 English strings now have a
Modern Standard Arabic counterpart in `locales/ar.json`, ICU placeholders and
plural contracts preserved exactly, so the parity gate covers it like French
and Spanish. It is labeled AI-drafted pending native review in
`locales/README.md`, honest about provenance the way the fr and es catalogs
are.

Enabling Arabic in Settings flips the whole admin, storefront and portal to
right-to-left automatically: the root layout already derives `dir` from the
locale's script, and the real-browser accessibility suite now proves it —
`html[lang=ar][dir=rtl]`, axe WCAG A/AA in both asserted themes, the bypass
link and 12-stop keyboard loop, and the 320px reflow refusal all run against
the catalog rather than an injected direction attribute. The same pass covers
populated contact, invoice, product and appointment forms, and ten owner
screens that were missing from the accessibility scan.

Arabic-speaking customers also get the legally protected SMS control words:
STOP/START/HELP now recognise Arabic keywords, and the mandatory compliance
replies answer in Arabic for an Arabic-preferred contact.
