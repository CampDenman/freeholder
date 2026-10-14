// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.03 (MASTER.md §44.4): a member's followers, follows, friends, requests,
// and the people they blocked, muted or restricted.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { myConnections } from "@/modules/members/graph";
import { myMembership } from "@/modules/members/service";
import { Button, Callout, Card, CardBody, CardHeader } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { memberGraphAction } from "../../../(public)/m/actions";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("members.connections.title"), robots: { index: false, follow: false } };
}

type Person = { handle: string; displayName: string };
type Verb = { verb: string; label: string; variant?: "quiet" | "danger" };

function People({ title, people, verbs, empty }: { title: string; people: Person[]; verbs: Verb[]; empty: string }) {
  return (
    <Card>
      <CardHeader title={`${title} (${people.length})`} />
      <CardBody>
        {people.length === 0 ? (
          <p className="text-ink-muted">{empty}</p>
        ) : (
          <ul className="grid gap-3">
            {people.map((person) => (
              <li key={person.handle} className="flex flex-wrap items-center justify-between gap-3">
                <a className="underline" href={`/@${person.handle}`}>{person.displayName} <span className="text-ink-muted">@{person.handle}</span></a>
                <span className="flex flex-wrap gap-2">
                  {verbs.map((v) => (
                    <form key={v.verb} action={memberGraphAction}>
                      <input type="hidden" name="handle" value={person.handle} />
                      <input type="hidden" name="verb" value={v.verb} />
                      <input type="hidden" name="back" value="connections" />
                      <Button type="submit" variant={v.variant}>{v.label}</Button>
                    </form>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [t, query, jar] = await Promise.all([getT(), searchParams, cookies()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const me = actor.kind === "user" ? await myMembership.call({}, actor) : null;
  if (!me) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">{t("members.connections.title")}</h1>
        <p>{t("members.profile.notMember")}</p>
        <a className="underline" href="/join">{t("members.join.title")}</a>
      </div>
    );
  }
  const c = await myConnections.call({}, actor);
  const none = t("members.connections.none");
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t("members.connections.title")}</h1>
      {query.error ? <Callout tone="danger">{t("members.graph.failed")}</Callout> : null}
      <People title={t("members.connections.followRequests")} people={c.followRequests} empty={none} verbs={[{ verb: "approve", label: t("members.connections.approve") }, { verb: "decline", label: t("members.connections.decline"), variant: "quiet" }]} />
      <People title={t("members.connections.friendRequests")} people={c.friendRequests} empty={none} verbs={[{ verb: "befriend", label: t("members.graph.acceptFriend") }, { verb: "unfriend", label: t("members.connections.decline"), variant: "quiet" }]} />
      <People title={t("members.connections.friends")} people={c.friends} empty={none} verbs={[{ verb: "unfriend", label: t("members.graph.unfriend"), variant: "quiet" }]} />
      <People title={t("members.connections.followers")} people={c.followers} empty={none} verbs={[{ verb: "decline", label: t("members.connections.remove"), variant: "quiet" }]} />
      <People title={t("members.connections.following")} people={c.following} empty={none} verbs={[{ verb: "unfollow", label: t("members.graph.unfollow"), variant: "quiet" }]} />
      <People title={t("members.connections.sent")} people={[...c.sentFollowRequests, ...c.sentFriendRequests]} empty={none} verbs={[]} />
      <People title={t("members.connections.blocked")} people={c.blocked} empty={none} verbs={[{ verb: "unblock", label: t("members.graph.unblock"), variant: "quiet" }]} />
      <People title={t("members.connections.muted")} people={c.muted} empty={none} verbs={[{ verb: "unmute", label: t("members.graph.unmute"), variant: "quiet" }]} />
      <People title={t("members.connections.restricted")} people={c.restricted} empty={none} verbs={[{ verb: "unrestrict", label: t("members.graph.unrestrict"), variant: "quiet" }]} />
    </div>
  );
}
