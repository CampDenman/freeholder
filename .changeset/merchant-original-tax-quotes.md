---
"freeholder": patch
---

C12.38: bind new merchant checkout quotes to explicit business tax declarations,
the buyer's declared destination and the original collection terms. Reuse exact
invoice arithmetic for the quote, retain each business's freight and tax cents,
and require a new review when accepted business or tax evidence changes.
Historical orders retain their original commercial epoch. The new collection
model remains disabled pending complete integration and qualification.
