// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The Link in bio screen's writes (C9.39). Thin, like every other caller
// (§11): each one is a `linkinbio.*` service call with the signed-in person
// as the actor, so the screen, the HTTP API and the MCP tools share one set of
// rules, one permission check and one audit trail.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { LINK_KINDS, LINK_STYLES, SOCIAL_NETWORKS, type LinkKind } from "@/modules/linkinbio/links";
import {
  addLink,
  removeLink,
  reorderLinks,
  setLinkHidden,
  setup,
  updateLink,
  updateProfile,
} from "@/modules/linkinbio/service";

const SCREEN = "/admin/link-in-bio";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function kindOf(form: FormData): LinkKind {
  const value = text(form, "kind");
  return (LINK_KINDS as readonly string[]).includes(value) ? (value as LinkKind) : "url";
}

/** A web link takes the typed address; a smart link takes the picked target. */
function targetOf(form: FormData, kind: LinkKind): string {
  if (kind === "url") return text(form, "url");
  const picked = text(form, `target-${kind}`) || text(form, "target");
  return picked;
}

function done(outcome: { error?: unknown; pending?: string | null } = {}): never {
  const { error } = outcome;
  if (error instanceof ServiceError) {
    redirect(`${SCREEN}?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("link-in-bio action failed");
  revalidatePath(SCREEN);
  redirect(outcome.pending ? `${SCREEN}?saved=1&pending=${outcome.pending}` : `${SCREEN}?saved=1`);
}

export async function setupLinkInBioAction(form: FormData): Promise<void> {
  let pending: string | null = null;
  try {
    const result = await setup.call(
      { slug: text(form, "slug") || "links", publish: form.get("publish") === "on" },
      await actor(),
    );
    pending = result.publication.pending;
  } catch (error) {
    done({ error });
  }
  done({ pending });
}

export async function addBioLinkAction(form: FormData): Promise<void> {
  const kind = kindOf(form);
  let pending: string | null = null;
  try {
    const result = await addLink.call(
      {
        label: text(form, "label"),
        kind,
        target: targetOf(form, kind),
        hidden: form.get("hidden") === "on",
        startsAt: text(form, "startsAt") || null,
        endsAt: text(form, "endsAt") || null,
      },
      await actor(),
    );
    pending = result.publication.pending;
  } catch (error) {
    done({ error });
  }
  done({ pending });
}

export async function updateBioLinkAction(form: FormData): Promise<void> {
  const kind = kindOf(form);
  let pending: string | null = null;
  try {
    const result = await updateLink.call(
      {
        id: text(form, "id"),
        label: text(form, "label"),
        kind,
        target: targetOf(form, kind),
        startsAt: text(form, "startsAt") || null,
        endsAt: text(form, "endsAt") || null,
      },
      await actor(),
    );
    pending = result.publication.pending;
  } catch (error) {
    done({ error });
  }
  done({ pending });
}

export async function toggleBioLinkAction(form: FormData): Promise<void> {
  let pending: string | null = null;
  try {
    const result = await setLinkHidden.call(
      { id: text(form, "id"), hidden: text(form, "hidden") === "1" },
      await actor(),
    );
    pending = result.publication.pending;
  } catch (error) {
    done({ error });
  }
  done({ pending });
}

/** Up or down one place: the whole new order goes to `reorderLinks`. */
export async function moveBioLinkAction(form: FormData): Promise<void> {
  const order = text(form, "order").split(",").filter(Boolean);
  const id = text(form, "id");
  const from = order.indexOf(id);
  const to = from + (text(form, "direction") === "up" ? -1 : 1);
  if (from < 0 || to < 0 || to >= order.length) done();
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  let pending: string | null = null;
  try {
    const result = await reorderLinks.call({ ids: next }, await actor());
    pending = result.publication.pending;
  } catch (error) {
    done({ error });
  }
  done({ pending });
}

export async function removeBioLinkAction(form: FormData): Promise<void> {
  let pending: string | null = null;
  try {
    if (form.get("confirm") !== "on") {
      throw new ServiceError("validation", "Tick the box to confirm removing this link.");
    }
    const result = await removeLink.call({ id: text(form, "id"), confirm: true }, await actor());
    pending = result.publication.pending;
  } catch (error) {
    done({ error });
  }
  done({ pending });
}

export async function saveBioProfileAction(form: FormData): Promise<void> {
  const style = text(form, "style");
  const strings = (name: string) =>
    form.getAll(name).map((value) => (typeof value === "string" ? value.trim() : ""));
  const networks = strings("socialNetwork");
  const urls = strings("socialUrl");
  const socials = networks
    .map((network, index) => ({ network, url: urls[index] ?? "" }))
    .filter(
      (item): item is { network: (typeof SOCIAL_NETWORKS)[number]; url: string } =>
        (SOCIAL_NETWORKS as readonly string[]).includes(item.network) && item.url !== "",
    );
  let pending: string | null = null;
  try {
    const result = await updateProfile.call(
      {
        name: text(form, "name"),
        bio: text(form, "bio"),
        avatarAssetId: text(form, "avatarAssetId") || null,
        style: (LINK_STYLES as readonly string[]).includes(style)
          ? (style as (typeof LINK_STYLES)[number])
          : undefined,
        socials,
      },
      await actor(),
    );
    pending = result.publication.pending;
  } catch (error) {
    done({ error });
  }
  done({ pending });
}
