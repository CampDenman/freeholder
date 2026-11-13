<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Original merchant erasure evidence callback

C12.38/C1.08. Source checkpoint `7ebd13de`, based on common source `160ae23e`,
adds the private system phase
`subscriptions.reconcileMerchantTaxErasureEvidence({profileId,sourceKey,evidenceDigest})`.
The financial owner calls it **after its source fact has committed**, using
the profile in the original immutable payment or charge receipt. It must not
derive ownership from a current account, email or replacement business.

The callback repairs only retained original erasure cohorts. A corrupted
artifact commits the existing recovery transition and returns
`recoveryRequired:true`; callers retry or report failure only after that phase
has returned. The callback is not proof that a caller stopped, money was
returned or provider inventory was empty. Those decisions remain in the
original financial and provider services.

Explicit Node22 TypeScript, focused lint and 26 private/audit/proof controls
passed. One actual native control on the existing disposable normal schema80
v6 database then passed in 5.595 seconds. It used real checkout, privacy,
shared-service and queue transactions with a synthetic paused payment edge.
It proved that a business without a subscription keeps its independently
committed original dispatch, refuses owner invocation of the system phase,
reuses its actual pending task and commits corrupt-artifact recovery without
replacing the artifact or minimizing the business.

The original provider promise was released in `finally`; the runner exited
successfully and the final database check found no active backends. No schema,
deadline or durability setting changed. Evidence is preserved in
`/tmp/freeholder-merchant-erasure-callback80-native.json`, its sibling `.log`
and `/tmp/freeholder-merchant-erasure-callback80-drain.json`.

Actual payment-return callbacks, periodic crash-window scans, a completed
cohort reopened by new physical money, and actual provider acceptance remain
separate qualification. The accepted-terms schema work is excluded from this
source and native candidate.
