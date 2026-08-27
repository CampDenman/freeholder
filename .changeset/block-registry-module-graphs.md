---
"freeholder": patch
---

Fix published pages that use a block contributed by a module — a portfolio
index, for one — failing to render in a production build with "no block type is
registered". The block registry now shares one store across module graphs
instead of giving each compiled copy its own.
