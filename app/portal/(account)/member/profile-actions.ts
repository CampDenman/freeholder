// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.20: a member's avatar and profile sections.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { deleteProfileSection, saveProfileSection, setAvatar } from "@/modules/members/profile";
import { setMyFederation } from "@/modules/members/federation/core";
import { followRemote, moveToRemote, setFediverseAliases, unfollowRemote } from "@/modules/members/federation/following";
import { revokeDevice } from "@/modules/members/e2ee/service";
import { PROFILE_SECTION_KINDS } from "@/modules/members/profile-kinds";
import { VISIBILITIES, type Visibility } from "@/modules/members/visibility";

const BACK = "/portal/member";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function run(work: (actor: Awaited<ReturnType<typeof actorFromToken>>) => Promise<unknown>): Promise<never> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    await work(actor);
  } catch (error) {
    if (error instanceof ServiceError) redirect(`${BACK}?error=${error.code}`);
    throw error;
  }
  redirect(`${BACK}?saved=1`);
}

export async function avatarAction(form: FormData): Promise<void> {
  await run((actor) => setAvatar.call({ assetId: form.get("remove") === "yes" ? null : text(form, "avatar") || null }, actor));
}

export async function sectionAction(form: FormData): Promise<void> {
  const kind = text(form, "kind");
  const visibility = text(form, "visibility");
  await run((actor) =>
    saveProfileSection.call(
      {
        id: text(form, "id") || undefined,
        kind: (PROFILE_SECTION_KINDS as readonly string[]).includes(kind) ? (kind as (typeof PROFILE_SECTION_KINDS)[number]) : "text",
        title: text(form, "title"),
        body: text(form, "body"),
        items: form.getAll("items").filter((v): v is string => typeof v === "string" && v.length > 0),
        visibility: (VISIBILITIES as readonly string[]).includes(visibility) ? (visibility as Visibility) : "public",
        position: Number(text(form, "position")) || 0,
      },
      actor,
    ),
  );
}

export async function deleteSectionAction(form: FormData): Promise<void> {
  await run((actor) => deleteProfileSection.call({ id: text(form, "id") }, actor));
}

// C12.18: join or leave the fediverse.
export async function federationAction(form: FormData): Promise<void> {
  await run((actor) => setMyFederation.call({ federated: form.get("federated") === "yes" }, actor));
}

// C12.23: take a device out of every encrypted conversation.
export async function revokeDeviceAction(form: FormData): Promise<void> {
  await run((actor) => revokeDevice.call({ deviceId: text(form, "deviceId") }, actor));
}

// C12.32: follow, or stop following, an account on another fediverse server.
export async function followRemoteAction(form: FormData): Promise<void> {
  await run((actor) => followRemote.call({ address: text(form, "address") }, actor));
}

export async function unfollowRemoteAction(form: FormData): Promise<void> {
  await run((actor) => unfollowRemote.call({ actorUri: text(form, "actorUri") }, actor));
}

// C12.33: name your accounts elsewhere, or move to one of them.
export async function aliasesAction(form: FormData): Promise<void> {
  const addresses = text(form, "aliases").split(/[\s,]+/).filter(Boolean);
  await run((actor) => setFediverseAliases.call({ addresses }, actor));
}

export async function moveAction(form: FormData): Promise<void> {
  if (form.get("confirm") !== "yes") redirect(`${BACK}?error=validation`);
  await run((actor) => moveToRemote.call({ address: text(form, "target") }, actor));
}
