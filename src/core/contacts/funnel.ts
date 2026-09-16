// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The second band: a stranger became somebody (MASTER.md §4.7, C9.07).
//
// "Lead" is the word two tools most reliably define differently without
// saying so, which is why C9.07 asks for the definitions to be inspectable.
// Here it means precisely one thing: a contact record came into existence in
// this period. Not a form submission (several become one contact, and §4.1
// says so), not a subscriber, not a session that looked interested.
//
// It lives in core because every business has contacts whatever else it has
// switched on — a funnel that lost its second step when a module was disabled
// would be a worse answer than no funnel at all.
import { sql } from "drizzle-orm";
import { registerFunnelStage } from "@/core/funnel/stages";
import { contacts } from "./schema";

registerFunnelStage({
  key: "lead",
  module: "core",
  band: "lead",
  labelKey: "funnel.stage.lead",
  definitionKey: "funnel.definition.lead",
  people: (window) => sql`
    select ${contacts.id}::text as person
    from ${contacts}
    where ${contacts.createdAt} >= ${window.from.toISOString()}::timestamptz
      and ${contacts.createdAt} < ${window.to.toISOString()}::timestamptz
  `,
});
