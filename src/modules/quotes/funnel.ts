// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Quotes, as funnel stages (MASTER.md §4.7, C9.07).
//
// Two stages rather than one, because being *offered* a price and *agreeing*
// to it are different events in a business's life, and collapsing them hides
// the number an owner most wants: how many of the quotes they wrote came back
// signed.
//
// A draft quote is not a stage. Nobody has seen it, so nothing has happened
// yet — counting drafts would let a slow week look busy.
import { sql } from "drizzle-orm";
import { registerFunnelStage } from "@/core/funnel/stages";
import { quotes } from "./schema";

registerFunnelStage({
  key: "quote",
  module: "quotes",
  band: "interest",
  labelKey: "funnel.stage.quote",
  definitionKey: "funnel.definition.quote",
  people: (window) => sql`
    select ${quotes.contactId}::text as person
    from ${quotes}
    where ${quotes.sentAt} is not null
      and ${quotes.sentAt} >= ${window.from.toISOString()}::timestamptz
      and ${quotes.sentAt} < ${window.to.toISOString()}::timestamptz
  `,
});

registerFunnelStage({
  key: "quoteAccepted",
  module: "quotes",
  band: "committed",
  labelKey: "funnel.stage.quoteAccepted",
  definitionKey: "funnel.definition.quoteAccepted",
  people: (window) => sql`
    select ${quotes.contactId}::text as person
    from ${quotes}
    where ${quotes.acceptedAt} is not null
      and ${quotes.acceptedAt} >= ${window.from.toISOString()}::timestamptz
      and ${quotes.acceptedAt} < ${window.to.toISOString()}::timestamptz
  `,
});
