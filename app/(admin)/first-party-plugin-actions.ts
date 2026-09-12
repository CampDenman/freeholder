// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  addGiftRegistryItem,
  createGiftRegistry,
  invoiceGiftRegistryItem,
} from "../../plugins/gift-registry/service";
import { queuePodJob, submitPodJob } from "../../plugins/print-on-demand/service";
import { createCommunitySpace, joinCommunity } from "../../plugins/community/service";
import {
  joinVoiceVideoRoom,
  missVoiceVideoRoom,
  recordVoiceVideoArtifact,
  startVoiceVideoRoom,
  stopVoiceVideoRoom,
} from "../../plugins/voice-video/service";
import {
  connectMarketplaceChannel,
  syncMarketplaceChannel,
} from "../../plugins/marketplace/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function done(path: string, error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("plugin action failed");
  redirect(`${path}${path.includes("?") ? "&" : "?"}saved=1`);
}

export async function createGiftRegistryAction(form: FormData): Promise<void> {
  const path = "/admin/gifts";
  try {
    await createGiftRegistry.call(
      {
        contactId: text(form, "contactId"),
        title: text(form, "title"),
        slug: text(form, "slug"),
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function addGiftRegistryItemAction(form: FormData): Promise<void> {
  const path = "/admin/gifts";
  try {
    await addGiftRegistryItem.call(
      {
        registryId: text(form, "registryId"),
        title: text(form, "title"),
        url: text(form, "url") || undefined,
        amountCents: Number.parseInt(text(form, "amountCents") || "0", 10) || 0,
        currency: text(form, "currency") || "USD",
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function invoiceGiftRegistryItemAction(form: FormData): Promise<void> {
  const path = "/admin/gifts";
  try {
    await invoiceGiftRegistryItem.call({ itemId: text(form, "itemId") }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function queuePodJobAction(form: FormData): Promise<void> {
  const path = "/admin/print-on-demand";
  try {
    const queued = await queuePodJob.call(
      {
        sku: text(form, "sku"),
        provider: text(form, "provider") || "printify",
      },
      await actor(),
    );
    await submitPodJob.call({ jobId: queued.id }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function retryPodJobAction(form: FormData): Promise<void> {
  const path = "/admin/print-on-demand";
  try {
    await submitPodJob.call({ jobId: text(form, "jobId") }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function createCommunitySpaceAction(form: FormData): Promise<void> {
  const path = "/admin/community";
  try {
    await createCommunitySpace.call(
      {
        slug: text(form, "slug"),
        title: text(form, "title"),
        access: text(form, "access") === "gated" ? "gated" : "open",
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function joinCommunityAction(form: FormData): Promise<void> {
  const path = "/admin/community";
  try {
    await joinCommunity.call(
      {
        spaceId: text(form, "spaceId"),
        contactId: text(form, "contactId"),
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function startVoiceVideoAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    await startVoiceVideoRoom.call(
      {
        contactId: text(form, "contactId"),
        kind: text(form, "kind") === "video" ? "video" : "voice",
        provider: text(form, "provider") || "fixture",
        title: text(form, "title"),
        roomId: text(form, "roomId") || undefined,
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function joinVoiceVideoAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    await joinVoiceVideoRoom.call(
      {
        roomId: text(form, "roomId"),
        contactId: text(form, "contactId"),
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function stopVoiceVideoAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    await stopVoiceVideoRoom.call({ roomId: text(form, "roomId") }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function missVoiceVideoAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    await missVoiceVideoRoom.call({ roomId: text(form, "roomId") }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function recordVoiceVideoAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    await recordVoiceVideoArtifact.call(
      {
        contactId: text(form, "contactId"),
        kind: text(form, "kind") === "video" ? "video" : "voice",
        provider: text(form, "provider") || "fixture",
        title: text(form, "title"),
        artifactId: text(form, "artifactId") || undefined,
        roomId: text(form, "roomId") || undefined,
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function connectMarketplaceAction(form: FormData): Promise<void> {
  const path = "/admin/marketplace";
  try {
    await connectMarketplaceChannel.call(
      {
        name: text(form, "name"),
        provider: text(form, "provider") as "shopify" | "etsy" | "amazon" | "ebay",
        channelId: text(form, "channelId") || undefined,
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function syncMarketplaceAction(form: FormData): Promise<void> {
  const path = "/admin/marketplace";
  try {
    await syncMarketplaceChannel.call({ channelId: text(form, "channelId") }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}
