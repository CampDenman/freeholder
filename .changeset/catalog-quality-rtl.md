---
"freeholder": minor
---

Continuously verify every English, French and Spanish catalog message for key
parity, non-empty copy, valid ICU syntax, executable formatting, and matching
argument and selector contracts.

Add shared locale fixtures, a synthesized expanded `en-XA` pseudo-locale, and
script-derived document direction. UI source now has a regression gate against
physical left/right layout utilities so future RTL catalogs mirror through
logical CSS without a layout rewrite.
