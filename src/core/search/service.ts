// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One staff query over registered user-owned records (C11.14). Live ILIKE,
// grant-filtered, no second document store.
import { z } from "zod";
import { listed, row, uuid } from "@/core/contract";
import { defineService, getService, permits, type Actor } from "@/core/service";
import { ilikeContains, searchSources, type SearchSource } from "./registry";
import "./sources";

const hit = row({
  kind: z.string(),
  id: uuid,
  title: z.string(),
  href: z.string(),
  snippet: z.string().nullable(),
  contactId: uuid.nullable(),
  module: z.string(),
});

function canSeeSource(actor: Actor, source: SearchSource): boolean {
  // C11.10/C11.14: a write scope is not read authority. Consult the actual
  // query contract for humans and API keys alike; module-prefix matching
  // leaked contact data and crossed notes/tasks/conversations grant families.
  const { def } = getService(source.readService);
  if (def.kind !== "query" || def.permission !== "scoped") return false;
  if (actor.kind === "agent" && def.agentCallable === false) return false;
  return permits(actor, def.permission, def.name, def.kind);
}

export const querySearch = defineService({
  name: "search.query",
  summary: "Find user-owned records across modules the caller can already open.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    q: z.string().trim().min(1).max(200),
    kinds: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  output: listed(hit),
  handler: async (input, ctx) => {
    const pattern = ilikeContains(input.q);
    const wanted = input.kinds ? new Set(input.kinds) : null;
    const selected = searchSources().filter((source) => {
      if (wanted && !wanted.has(source.kind)) return false;
      return canSeeSource(ctx.actor, source);
    });
    const buckets = await Promise.all(
      selected.map((source) =>
        source.search({
          tx: ctx.tx,
          actor: ctx.actor,
          pattern,
          limit: input.limit,
        }),
      ),
    );
    const hits = [];
    for (let offset = 0; hits.length < input.limit; offset += 1) {
      let added = false;
      for (const bucket of buckets) {
        const hit = bucket[offset];
        if (!hit) continue;
        hits.push(hit);
        added = true;
        if (hits.length >= input.limit) break;
      }
      if (!added) break;
    }
    return hits;
  },
});

export {
  SEARCH_TABLE_OPT_OUTS,
  registerSearchSource,
  searchSources,
} from "./registry";

export default [querySearch];
