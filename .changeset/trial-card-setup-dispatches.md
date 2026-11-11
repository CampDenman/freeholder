---
"freeholder": minor
"@freeholder/sdk": minor
---

Freeze a card trial’s original customer, account, currency, return addresses and request keys before provider I/O. Commit every physical Customer or Checkout dispatch separately, retain every actual response, and require the exact agreement’s confirmed saved-method proof before opening a zero-fee card trial. Retries preserve their first inputs; unknown outcomes remain unresolved even after the safe request-key window or an empty provider search.

Keep privacy erasure pending until every original setup dispatch has a final outcome and every recorded customer is actually deleted on its original account. Freshly verified people can record concrete original-provider final-outcome and stopped-caller evidence; completed resources also require positive original-account metadata checks. This recovery is explicitly human-confirmed. Agents, system actors and stale verification cannot supply the confirmation. Four-locale owner recovery and customer trial flows share the service permissions and audit trail.

Migration70 deliberately refuses older application images that would start an unrelated-card trial, discard an unresolved request or complete its erasure early. Full rollback requires restoring the pre-upgrade database and object snapshot. These source controls do not supply live provider acceptance, independent review or stable release approval; seller-as-merchant activation remains unavailable.

Limit generic setup/recovery audit inputs to operation identities and outcomes; keep concrete personal provider evidence in its private source until its hold or cleanup permits erasure. Preserve the original actor/action/subject history.

Require subscription management and fresh human verification to inspect private recovery evidence through the API as well as the UI. Let authorized managers review the exact recorded evidence.

Preserve safe contact merge undo by comparing locked setup/dispatch fingerprints without copying personal inputs into recovery snapshots. The combined history is bounded to 5,000 records; overflow makes the merge non-undoable, and later growth beyond the bound refuses separation. New or changed provider work blocks unsafe identity separation; upgrade and prior-image merge records retain this undo boundary.
