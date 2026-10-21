// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatDateTime } from "@/core/i18n";
import { ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { getLocale, getT } from "../i18n";
import {
  addGiftRegistryItem,
  createGiftRegistry,
  invoiceGiftRegistryItem,
} from "../../plugins/gift-registry/service";
import { mapPodSku, queuePodJob, refreshPodJob, submitPodJob } from "../../plugins/print-on-demand/service";
import {
  createCommunityRoom,
  createCommunitySpace,
  hideCommunityPost,
  joinCommunity,
  removeCommunityPost,
} from "../../plugins/community/service";
import {
  createVoiceVideoMeetingLink,
  voiceVideoRecordingAccess,
  importVoiceVideoRecording,
  joinVoiceVideoRoom,
  missVoiceVideoRoom,
  recordVoiceVideoArtifact,
  startVoiceVideoRoom,
  stopVoiceVideoRoom,
  configureVoiceVideo,
  controlVoiceVideoRecording,
  verifyVoiceVideoConnection,
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

export async function mapPodSkuAction(form: FormData): Promise<void> {
  const path = "/admin/print-on-demand";
  try {
    await mapPodSku.call(
      {
        sku: text(form, "sku"),
        provider: text(form, "provider") || "printify",
        providerProductId: text(form, "providerProductId"),
        providerVariantId: text(form, "providerVariantId") ? Number(text(form, "providerVariantId")) : undefined,
      },
      await actor(),
    );
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

export async function refreshPodJobAction(form: FormData): Promise<void> {
  const path = "/admin/print-on-demand";
  try {
    await refreshPodJob.call({ jobId: text(form, "jobId") }, await actor());
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
  const spaceId = text(form, "spaceId");
  const path = `/admin/community?space=${encodeURIComponent(spaceId)}`;
  try {
    await joinCommunity.call(
      {
        spaceId,
        contactId: text(form, "contactId"),
        role: text(form, "role") === "moderator" ? "moderator" : "member",
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath("/admin/community");
  done(path);
}

export async function createCommunityRoomAction(form: FormData): Promise<void> {
  const spaceId = text(form, "spaceId");
  const path = `/admin/community?space=${encodeURIComponent(spaceId)}`;
  try {
    await createCommunityRoom.call(
      {
        spaceId,
        slug: text(form, "slug"),
        title: text(form, "title"),
      },
      await actor(),
    );
  } catch (error) {
    done(path, error);
  }
  revalidatePath("/admin/community");
  done(path);
}

export async function hideCommunityPostAction(form: FormData): Promise<void> {
  const spaceId = text(form, "spaceId");
  const path = `/admin/community?space=${encodeURIComponent(spaceId)}`;
  try {
    await hideCommunityPost.call({ postId: text(form, "postId") }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath("/admin/community");
  done(path);
}

export async function removeCommunityPostAction(form: FormData): Promise<void> {
  const spaceId = text(form, "spaceId");
  const path = `/admin/community?space=${encodeURIComponent(spaceId)}`;
  try {
    await removeCommunityPost.call({ postId: text(form, "postId") }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath("/admin/community");
  done(path);
}

export async function startVoiceVideoAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    await startVoiceVideoRoom.call(
      {
        contactId: text(form, "contactId"),
        kind: text(form, "kind") === "video" ? "video" : "voice",
        provider: text(form, "provider") || "daily",
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
    await stopVoiceVideoRoom.call({ roomId: text(form, "roomId"), capture: false }, await actor());
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
        provider: text(form, "provider") || "daily",
        title: text(form, "title"),
        artifactId: text(form, "artifactId") || undefined,
        refresh: text(form, "refresh") === "true",
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
    const result = await syncMarketplaceChannel.call(
      { channelId: text(form, "channelId") },
      await actor(),
    );
    if (result.lastError) {
      done(path, new ServiceError("conflict", result.lastError));
    }
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function voiceVideoHostAction(form: FormData): Promise<void> {
  const result = await createVoiceVideoMeetingLink.call({ roomId: text(form, "roomId"), audience: "host", hostName: text(form, "hostName") || "Host" }, await actor());
  const url = new URL(result.roomUrl);
  url.searchParams.set("t", result.meetingToken);
  redirect(url.toString());
}

export interface IssuedCallCredential {
  roomUrl: string;
  meetingToken: string;
  expiresAt: number;
  expiresAtLabel: string;
  livekitUrl: string | null;
  iceServers: unknown[] | null;
}

async function issueCallCredential(form: FormData, audience: "host" | "guest"): Promise<{ credential?: IssuedCallCredential; redirectUrl?: string; error?: string }> {
  try {
    const result = await createVoiceVideoMeetingLink.call({ roomId: text(form, "roomId"), audience, hostName: text(form, "hostName") || "Host" }, await actor());
    // Paradise Comms/LiveKit issues connection details, not a hosted join
    // page: render them for copy into a LiveKit client. Daily's prebuilt URL
    // keeps the redirect-with-token flow.
    if (result.livekitUrl) {
      // PM grants its own TTL — observed 60 seconds against the 30 minutes
      // requested — so the panel shows the provider's real expiry in the
      // business timezone (§4.9), never the requested duration.
      const [t, locale, business] = await Promise.all([getT(), getLocale(), currentBusiness()]);
      const when = formatDateTime(new Date(result.expiresAt * 1000), business?.timezone ?? "UTC", locale);
      return { credential: { roomUrl: result.roomUrl, meetingToken: result.meetingToken, expiresAt: result.expiresAt,
        expiresAtLabel: t("voiceVideo.credentialsExpire", { when }), livekitUrl: result.livekitUrl, iceServers: result.iceServers } };
    }
    const url = new URL(result.roomUrl);
    url.searchParams.set("t", result.meetingToken);
    return { redirectUrl: url.toString() };
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

export async function voiceVideoHostJoinAction(_previous: { credential?: IssuedCallCredential; redirectUrl?: string; error?: string }, form: FormData): Promise<{ credential?: IssuedCallCredential; redirectUrl?: string; error?: string }> {
  return issueCallCredential(form, "host");
}

export async function voiceVideoInviteAction(_previous: { inviteTokenUrl?: string; credential?: IssuedCallCredential; error?: string }, form: FormData): Promise<{ inviteTokenUrl?: string; credential?: IssuedCallCredential; error?: string }> {
  const issued = await issueCallCredential(form, "guest");
  if (issued.redirectUrl) return { inviteTokenUrl: issued.redirectUrl };
  return issued;
}

export async function voiceVideoConfigureAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    const retention = text(form, "retentionDays");
    await configureVoiceVideo.call({
      provider: text(form, "provider") === "daily" ? "daily" : "paradise",
      paradise: {
        baseUrl: text(form, "baseUrl") || undefined,
        authScheme: text(form, "authScheme") === "portfolio_token" ? "portfolio_token" : "site_key",
        apiKey: text(form, "apiKey") || undefined,
        portfolioToken: text(form, "portfolioToken") || undefined,
        webhookSecret: text(form, "webhookSecret") || undefined,
        roomPolicy: ["open", "moderated", "invite_only"].includes(text(form, "roomPolicy")) ? text(form, "roomPolicy") as "open" | "moderated" | "invite_only" : undefined,
        retentionDays: retention ? Number.parseInt(retention, 10) : null,
      },
    }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function voiceVideoVerifyAction(_previous: { ok?: boolean; message?: string; topUpUrl?: string; status?: number | null }, form: FormData): Promise<{ ok?: boolean; message?: string; topUpUrl?: string; status?: number | null }> {
  void form;
  try {
    const result = await verifyVoiceVideoConnection.call({}, await actor());
    return { ok: result.ok, message: result.message, topUpUrl: result.topUpUrl ?? undefined, status: result.status };
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function voiceVideoRecordingAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    await controlVoiceVideoRecording.call({ roomId: text(form, "roomId"), action: text(form, "action") === "stop" ? "stop" : "start" }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}

export async function voiceVideoDownloadAction(form: FormData): Promise<void> {
  const result = await voiceVideoRecordingAccess.call({ artifactId: text(form, "artifactId") }, await actor());
  redirect(result.downloadTokenUrl);
}

export async function voiceVideoImportAction(form: FormData): Promise<void> {
  const path = "/admin/voice-video";
  try {
    await importVoiceVideoRecording.call({ artifactId: text(form, "artifactId") }, await actor());
  } catch (error) {
    done(path, error);
  }
  revalidatePath(path);
  done(path);
}
