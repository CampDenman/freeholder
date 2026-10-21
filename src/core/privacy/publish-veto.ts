// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// A veto on rendering an otherwise-published page (MASTER.md C8.16).
//
// `pages.status` is the platform's record of "this may render", and most of
// the time it is enough. It is not enough for pages whose publishability is
// decided somewhere else: a case-study page is published by an owner but
// *un*-published by a client taking their permission back, and the CMS cannot
// be asked to know that — projects depends on CMS, so CMS asking projects
// would be a cycle. The registry is the seam: a module that knows why a page
// should not currently render registers a veto, and the public read paths
// (`cms.resolvePage`, `cms.publishedPaths`) consult every registered veto
// before answering. Withdrawal therefore lands on the page and the sitemap
// even for a row whose status flag was flipped back by hand, because the
// answer is derived from the consent ledger at read time, not from a flag
// maintained at write time.
//
// Vetoes run on the public read path, so `appliesTo` is a cheap pre-filter
// (string shape) and `blocks` must be a small number of indexed reads.
import type { Tx } from "@/core/service";

export interface PublishedPageRef {
  id: string;
  slug: string;
}

export interface PublishVeto {
  /** Stable id, surfaced in logs when it blocks. */
  id: string;
  /** Cheap pre-filter: true when this veto could care about this page. */
  appliesTo(page: PublishedPageRef): boolean;
  /** True when the page must not render right now. */
  blocks(tx: Tx, page: PublishedPageRef): Promise<boolean>;
}

const registeredVetoes: PublishVeto[] = [];

export function registerPublishVeto(veto: PublishVeto): void {
  if (registeredVetoes.some((existing) => existing.id === veto.id)) return;
  registeredVetoes.push(veto);
}

/** Registered vetoes, for tests that need to assert the registry itself. */
export function publishVetoes(): readonly PublishVeto[] {
  return registeredVetoes;
}

/** Ids of the vetoes currently blocking this page, in registration order. */
export async function blockingVetoes(
  tx: Tx,
  page: PublishedPageRef,
): Promise<string[]> {
  const blocked: string[] = [];
  for (const veto of registeredVetoes) {
    if (!veto.appliesTo(page)) continue;
    if (await veto.blocks(tx, page)) blocked.push(veto.id);
  }
  return blocked;
}
