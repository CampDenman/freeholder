// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Gated communities (MASTER.md §36, C3.13).
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { listContacts } from "@/core/contacts/service";
import {
  listCommunityFeed,
  listCommunityJoinRequests,
  listCommunityMembers,
  listCommunityModeration,
  listCommunityRooms,
  listCommunitySpaces,
} from "../../../../plugins/community/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  createCommunityRoomAction,
  createCommunitySpaceAction,
  hideCommunityPostAction,
  joinCommunityAction,
  removeCommunityPostAction,
} from "../../first-party-plugin-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; space?: string }>;
}) {
  const actor = await requireStaffActor("community", "manage");
  const query = await searchParams;
  const [t, spaces, people] = await Promise.all([
    getT(),
    domainOrNull(listCommunitySpaces.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
  ]);
  const chosen =
    (spaces ?? []).find((row) => row.id === query.space) ?? (spaces ?? [])[0] ?? null;
  const [members, rooms, feed, moderation, requests] = chosen
    ? await Promise.all([
        domainOrNull(listCommunityMembers.call({ spaceId: chosen.id }, actor)),
        domainOrNull(listCommunityRooms.call({ spaceId: chosen.id }, actor)),
        domainOrNull(listCommunityFeed.call({ spaceId: chosen.id }, actor)),
        domainOrNull(listCommunityModeration.call({ spaceId: chosen.id }, actor)),
        domainOrNull(listCommunityJoinRequests.call({ spaceId: chosen.id }, actor)),
      ])
    : [[], [], [], [], []];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("community.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("community.intro")}</p>
      </div>
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("community.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      <Card>
        <CardHeader title={t("community.create")} />
        <CardBody>
          <form action={createCommunitySpaceAction} className="grid gap-3 sm:grid-cols-3">
            <Field label={t("community.field.title")} htmlFor="community-title">
              <Input id="community-title" name="title" required />
            </Field>
            <Field label={t("community.field.slug")} htmlFor="community-slug">
              <Input id="community-slug" name="slug" required />
            </Field>
            <Field label={t("community.field.access")} htmlFor="community-access">
              <Select id="community-access" name="access" defaultValue="open">
                <option value="open">{t("community.access.open")}</option>
                <option value="gated">{t("community.access.gated")}</option>
              </Select>
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit">{t("community.create")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("community.list")} />
        <CardBody>
          {(spaces ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("community.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(spaces ?? []).map((space) => (
                <li key={space.id}>
                  <a className="text-sm font-medium text-accent" href={`/admin/community?space=${space.id}`}>
                    {space.title}
                  </a>
                  <Pill tone="neutral">{t(`community.access.${space.access}`)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {chosen ? (
        <>
          <Card>
            <CardHeader title={chosen.title} />
            <CardBody>
              <p className="text-sm text-ink-muted">
                {t("community.members", { count: (members ?? []).length })}
              </p>
              <form action={joinCommunityAction} className="mt-3 grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="spaceId" value={chosen.id} />
                <Field label={t("community.field.contact")} htmlFor="community-contact">
                  <Select id="community-contact" name="contactId" required>
                    <option value="">{t("community.field.contact")}</option>
                    {(people?.rows ?? []).map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("community.field.role")} htmlFor="community-role">
                  <Select id="community-role" name="role" defaultValue="member">
                    <option value="member">{t("community.role.member")}</option>
                    <option value="moderator">{t("community.role.moderator")}</option>
                  </Select>
                </Field>
                <div className="flex items-end">
                  <Button type="submit">{t("community.addMember")}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("community.joinRequests")} />
            <CardBody>
              {(requests ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">{t("community.joinRequestsEmpty")}</p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {(requests ?? []).map((request) => (
                    <li key={request.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                      <span>{request.name}</span>
                      <span className="text-ink-muted">{request.email}</span>
                      <form action={joinCommunityAction}>
                        <input type="hidden" name="spaceId" value={chosen.id} />
                        <input type="hidden" name="contactId" value={request.contactId} />
                        <Button type="submit" variant="quiet">
                          {t("community.addMember")}
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("community.rooms")} />
            <CardBody>
              <form action={createCommunityRoomAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="spaceId" value={chosen.id} />
                <Field label={t("community.field.title")} htmlFor="community-room-title">
                  <Input id="community-room-title" name="title" required />
                </Field>
                <Field label={t("community.field.slug")} htmlFor="community-room-slug">
                  <Input id="community-room-slug" name="slug" required />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit">{t("community.createRoom")}</Button>
                </div>
              </form>
              {(rooms ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">{t("community.roomsEmpty")}</p>
              ) : (
                <ul className="mt-3 grid list-none gap-2 p-0">
                  {(rooms ?? []).map((room) => (
                    <li key={room.id} className="text-sm">
                      {room.title}{" "}
                      <span className="font-mono text-xs text-ink-muted">{room.slug}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("community.posts")} />
            <CardBody>
              {(feed ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">{t("community.postsEmpty")}</p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {(feed ?? []).map((post) => (
                    <li key={post.id} className="rounded-md border border-rule p-3 text-sm">
                      <p className="font-medium">{post.authorName}</p>
                      <p className="text-ink-muted">{post.roomTitle}</p>
                      <p className="mt-1 whitespace-pre-wrap">{post.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("community.moderation")} />
            <CardBody>
              {(moderation ?? []).length === 0 ? (
                <p className="text-sm text-ink-muted">{t("community.moderationEmpty")}</p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {(moderation ?? []).map((post) => (
                    <li key={post.id} className="flex flex-wrap items-start gap-3 rounded-md border border-rule p-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{post.authorName}</p>
                        <p className="whitespace-pre-wrap">{post.body}</p>
                      </div>
                      <Pill tone={post.status === "removed" ? "danger" : "warning"}>
                        {t(`community.status.${post.status}`)}
                      </Pill>
                      {post.reportedAt ? <Pill tone="warning">{t("community.reported")}</Pill> : null}
                      {post.status === "visible" || post.status === "hidden" ? (
                        <form action={hideCommunityPostAction}>
                          <input type="hidden" name="spaceId" value={chosen.id} />
                          <input type="hidden" name="postId" value={post.id} />
                          <Button type="submit" variant="quiet">
                            {t("community.hide")}
                          </Button>
                        </form>
                      ) : null}
                      {post.status !== "removed" ? (
                        <form action={removeCommunityPostAction}>
                          <input type="hidden" name="spaceId" value={chosen.id} />
                          <input type="hidden" name="postId" value={post.id} />
                          <Button type="submit" variant="danger">
                            {t("community.remove")}
                          </Button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
