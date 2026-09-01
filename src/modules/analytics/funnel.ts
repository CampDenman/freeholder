// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The top of the funnel: people who turned up (MASTER.md §4.7, C9.07).
//
// This is the only stage whose people are mostly strangers, and the reason the
// funnel uses a person key rather than a contact id. A visitor is
// `anon:<anon_id>` until they identify themselves, at which point
// `analytics.identify` backfills their contact id across everything they did
// before — so the same human is one row here whether they identified before
// or after the visit, which is what makes this a funnel rather than two
// unrelated numbers.
//
// Bots are excluded, using the same `coalesce(override, kind)` the rest of the
// module reads by. An owner who corrects a classification changes this number
// too, which is the point of keeping the rows rather than filtering at write
// time.
import { sql } from "drizzle-orm";
import { registerFunnelStage } from "@/core/funnel/stages";
import { analyticsEvents } from "./schema";

registerFunnelStage({
  key: "visit",
  module: "analytics",
  band: "visit",
  labelKey: "funnel.stage.visit",
  definitionKey: "funnel.definition.visit",
  people: (window) => sql`
    select distinct coalesce(
      ${analyticsEvents.contactId}::text,
      'anon:' || ${analyticsEvents.anonId}
    ) as person
    from ${analyticsEvents}
    where ${analyticsEvents.at} >= ${window.from.toISOString()}::timestamptz
      and ${analyticsEvents.at} < ${window.to.toISOString()}::timestamptz
      and coalesce(
        ${analyticsEvents.classificationOverride},
        ${analyticsEvents.visitorKind}
      ) = 'human'
  `,
});
