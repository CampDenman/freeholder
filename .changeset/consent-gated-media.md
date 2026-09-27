---
"freeholder": patch
---

C8.16: Before/after pairs and progress series now publish only against a recorded consent, and a withdrawal unpublishes from every surface in one action.

The consent ledger from the first half of this item is enforced at the render layer, not just at the publish button. New `consentBlockedProjectIds`/`consentBlockedAssetIds` in the projects module re-derive what may render from the ledger at read time, and every public query path that can surface the media consults them: the portfolio index and collections, the service page's proof-of-work list, and the structured-data query behind a case study's CreativeWork JSON-LD all drop a project the moment its permission stops standing. Public galleries apply the same rule to their items — a withdrawn frame disappears from the session list, refuses direct view and download by item id, is left out of rebuilt ZIP archives, and holds any archive that might predate the withdrawal offline.

Pages and sitemaps read `pages.status`, which the withdrawal maintains — and a new publish-veto registry in `core/privacy` closes the gap a hand-flipped flag would leave: `cms.resolvePage` and `cms.publishedPaths` consult registered vetoes before answering, so a case-study page whose client's consent no longer stands refuses to render and leaves the sitemap even if its status is put back by hand. The veto is registered from the projects module and re-reads the consent ledger on every public answer; the portfolio index and collection pages are deliberately not vetoed, because they re-derive their project lists at render time and a withdrawn project should not take unrelated work offline with it.

A published time series also becomes real publishing machinery rather than loose images: the case-study snapshot now carries `seriesKey` and `capturedAt` into the `projectCaseStudy` block, the block accepts the `series` role, and the public page renders each series as a dated, chronologically ordered strip under a "Progress over time" heading (new `projects.public.progress` key, en/fr/es/ar).

The ownership export's media manifest now carries each asset's capture provenance alongside the byte inventory, and the consent ledger exports as a table with everything else — provenance and permission history both survive export.
