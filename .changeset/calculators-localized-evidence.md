---
"freeholder": patch
---

C5.26: Calculators now refuse in the visitor's own words, and carry every assumption beside the figure.

A refusal is now data as well as prose: `calculators.compute` answers a declined calculation with a stable `refusalCode` and the key of the input or published figure at fault, alongside the English detail it always carried. The public block renders the refusal from that code through the catalog — en, fr, es and ar each have the full refusal vocabulary, so a stale or missing figure declines in the same words whatever language the page is being read in, and the service's English sentence never leaks onto a non-English page.

A result now arrives with its working, not just its caveats. Beside the figure the block lists every published input the arithmetic rested on — key, value, source and as-of date, in the business's timezone and the request's locale — above the as-of of the oldest of them, which is how old the answer really is. A new locale gate scans every calculator-reachable string in all four catalogs against quote, approval and guarantee vocabulary in each language, so no surface can present a figure as any of the three no matter how the strings are refactored.

The Aurora Coast demo seeds two working calculators through the services on a new Planning page — a wedding-day affordability figure and an off-season print-credit eligibility figure — each resting on published, dated, sourced figures in integer minor units, with the print credit's terms carrying a `valid_until` so the demo shows a calculator declining on schedule rather than answering from expired terms.
