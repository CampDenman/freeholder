// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Referrals and attribution (MASTER.md §4.3, §4.13, C9.09).
//
// Requires only core. A referrer is "a Contact like everyone else" (§4.3), a
// touch is recorded against the platform's own visitor id, and attribution is
// computed from those two — so this module works on an instance with no shop,
// no bookings and no invoicing, and gains meaning rather than function when
// they are switched on.
//
// C9.09 recorded and attributed and paid nobody. C9.10 added the half that
// pays: commission events, holdbacks, reversal, payout batches and the CSV.
//
// It still requires only core. Paying a referrer in loyalty points happens
// without loyalty appearing here at all — this module emits
// `referral.converted` and a loyalty `EarnRule` matches it, which is §4.13's
// "earning is a listener on spine events, never a call from inside another
// module" read literally.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "referrals",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  jobs: () => import("./jobs"),
  events: {
    emits: [
      "referral.codeIssued",
      "referral.invited",
      "referral.invitationAccepted",
      // §4.13 names "a referral converted" as an earning moment a loyalty
      // rule may listen for. This is that event.
      "referral.converted",
      "referral.commissionEarned",
      "referral.commissionReversed",
      "referral.commissionClawedBack",
      "referral.payoutBatchBuilt",
      "referral.payoutBatchApproved",
      "referral.payoutBatchPaid",
    ],
    listens: {
      // The invoice is "the single money object" (§4.3), so listening to it
      // catches an order, a booking, an accepted quote and a subscription
      // cycle exactly once each. See `spine.ts` for why nothing else is here.
      "invoice.paid": "onSpineEvent",
      // A signup has no invoice (§4.3), so it is its own conversion.
      "contact.created": "onSpineEvent",
      "invoice.refunded": "onSpineEvent",
    },
  },
});
