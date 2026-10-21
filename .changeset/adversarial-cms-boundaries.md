---
"freeholder": patch
"@freeholder/sdk": patch
---

Keep unpublished page drafts, editorial notes and paywall bodies out of public API responses. Full page snapshots stay inside the server renderer, which checks the viewer's access before rendering gated content; owners and scoped agents use the existing page management services for editing.

Serialize page changes and check the exact reviewed version when publishing. Keep newer typing unsaved until it reaches the server, and offer reload or reviewed merge after a publishing conflict. Rejoining a template now edits the working draft without changing a live page before publication.
