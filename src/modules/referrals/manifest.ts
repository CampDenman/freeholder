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
// C9.09 records and attributes. It pays nobody: CommissionEvent, holdbacks
// and payout batches are C9.10, which reads what this stores.
import { defineModule } from "@/core/module";

export default defineModule({
  name: "referrals",
  version: "0.1.0",
  requires: ["core"],
  tables: () => import("./tables"),
  services: () => import("./service"),
  events: {
    emits: ["referral.codeIssued", "referral.invited", "referral.invitationAccepted"],
  },
});
