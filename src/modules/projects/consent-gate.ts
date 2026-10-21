// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The render-path half of consent-gated media (MASTER.md C8.16).
//
// `projects.publish` refuses client work whose publication permission does not
// stand, and `projects.revokeConsent` takes the case-study page down in the
// same action — but a gate that only fires when somebody pushes on it is not
// a gate, it is a hope. These helpers are the second line: every public
// query/render path that can surface progress or comparison media asks them
// what may render *right now*, so a lapsed grant between sweeps, a withdrawal
// written straight to the ledger, or a row left behind by a retry cannot put
// somebody's picture back on a public page.
//
// The rule is deliberately conservative. A project that names a client needs
// live consent for any of its media to render anywhere public; an asset
// attached to a blocked project is blocked on every surface, because the same
// photograph in a gallery is the same likeness. Work with no client named
// (internal projects) never blocks: there is nobody whose permission it could
// be.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { isLive, latestDecision } from "@/core/privacy/media-consent";
import { registerPublishVeto } from "@/core/privacy/publish-veto";
import { projectFiles, projects } from "./schema";

/**
 * Client-named projects whose publication permission does not currently
 * stand — never given, withdrawn, or lapsed.
 *
 * Never-given belongs in the same set as the other two, not a separate case:
 * to a renderer, all three answers mean the same thing.
 */
export async function consentBlockedProjectIds(
  tx: Tx,
  projectIds: readonly string[],
  now = new Date(),
): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const clientWork = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(inArray(projects.id, [...projectIds]), isNotNull(projects.contactId)));
  const blocked = new Set<string>();
  for (const row of clientWork) {
    if (!isLive(await latestDecision(tx, "project", row.id), now)) {
      blocked.add(row.id);
    }
  }
  return blocked;
}

/**
 * Assets that must not render on a public surface right now: attached to at
 * least one client-named project whose consent does not stand.
 */
export async function consentBlockedAssetIds(
  tx: Tx,
  assetIds: readonly string[],
  now = new Date(),
): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set();
  const attachments = await tx
    .select({
      assetId: projectFiles.assetId,
      projectId: projectFiles.projectId,
    })
    .from(projectFiles)
    .where(inArray(projectFiles.assetId, [...assetIds]));
  if (attachments.length === 0) return new Set();
  const blockedProjects = await consentBlockedProjectIds(
    tx,
    [...new Set(attachments.map((row) => row.projectId))],
    now,
  );
  const blocked = new Set<string>();
  for (const row of attachments) {
    if (blockedProjects.has(row.projectId)) blocked.add(row.assetId);
  }
  return blocked;
}

/**
 * The page half of the gate. A case-study page stays renderable only while
 * the consent of the client it names stands — so a withdrawal reaches the
 * page itself and the sitemap even if `pages.status` is ever put back by
 * hand. The portfolio index and collection pages are never blocked by this
 * veto: they re-derive their project lists at render time, so a withdrawn
 * project disappears from them without taking unrelated work offline.
 */
registerPublishVeto({
  id: "project.mediaConsent",
  appliesTo: (page) => page.slug.startsWith("portfolio/"),
  blocks: async (tx, page) => {
    const linked = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.publicPageId, page.id), isNotNull(projects.contactId)),
      )
      .limit(1);
    if (linked.length === 0) return false;
    return (await consentBlockedProjectIds(tx, linked.map((row) => row.id))).size > 0;
  },
});
