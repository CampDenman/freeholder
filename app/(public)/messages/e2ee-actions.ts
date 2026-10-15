// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.23: the browser device's way to the delivery service. Everything that
// passes through here is already ciphertext, public keys, or key packages.
"use server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { sendMessage, startConversation } from "@/modules/members/messages";
import { claimKeyPackages, e2eeCommit, e2eeSync, publishKeyPackages, registerDevice, sendEncrypted } from "@/modules/members/e2ee/service";

type Result<T> = { ok: T } | { error: { code: string; message: string } };

async function run<T>(work: (actor: Awaited<ReturnType<typeof actorFromToken>>) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: await work(await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value)) };
  } catch (error) {
    if (error instanceof ServiceError) return { error: { code: error.code, message: error.message } };
    throw error;
  }
}

export async function registerDeviceAction(input: Parameters<typeof registerDevice.call>[0]) {
  return run((actor) => registerDevice.call(input, actor));
}
export async function publishKeyPackagesAction(input: Parameters<typeof publishKeyPackages.call>[0]) {
  return run((actor) => publishKeyPackages.call(input, actor));
}
export async function e2eeSyncAction(input: Parameters<typeof e2eeSync.call>[0]) {
  return run((actor) => e2eeSync.call(input, actor));
}
export async function claimKeyPackagesAction(input: Parameters<typeof claimKeyPackages.call>[0]) {
  return run((actor) => claimKeyPackages.call(input, actor));
}
export async function e2eeCommitAction(input: Parameters<typeof e2eeCommit.call>[0]) {
  return run((actor) => e2eeCommit.call(input, actor));
}
export async function sendEncryptedAction(input: Parameters<typeof sendEncrypted.call>[0]) {
  return run((actor) => sendEncrypted.call(input, actor));
}
/** Start a conversation with no plaintext; the device sends the first message encrypted. */
export async function openConversationAction(input: { handles: string[]; title?: string }) {
  return run((actor) => startConversation.call(input, actor));
}
/** Plaintext, only while someone in the conversation has no device; the service refuses it otherwise. */
export async function sendPlaintextAction(input: Parameters<typeof sendMessage.call>[0]) {
  return run((actor) => sendMessage.call(input, actor));
}
