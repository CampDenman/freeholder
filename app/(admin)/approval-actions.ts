// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the approval inbox (C4.04). Once-only execution, expiry
// and the decision audit live in the agents services shared with HTTP/MCP.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { approveWrite, rejectWrite } from "@/core/agents/writes";

const INBOX = "/admin/work/approvals";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function currentActor() {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return { ...actor, request: requestMetadataFromHeaders(await headers()) };
}

function fail(error: unknown): never {
  if (error instanceof ServiceError && error.code === "step_up_required") {
    redirect(`/security/verify?returnTo=${encodeURIComponent(INBOX)}`);
  }
  const code = error instanceof ServiceError ? error.code : "failed";
  redirect(`${INBOX}?error=${encodeURIComponent(code)}`);
}

export async function approveWriteAction(form: FormData): Promise<void> {
  try {
    await approveWrite.call(
      { id: field(form, "id"), note: field(form, "note") || undefined },
      await currentActor(),
    );
  } catch (error) {
    fail(error);
  }
  redirect(`${INBOX}?saved=approved`);
}

export async function rejectWriteAction(form: FormData): Promise<void> {
  try {
    await rejectWrite.call(
      { id: field(form, "id"), note: field(form, "note") },
      await currentActor(),
    );
  } catch (error) {
    fail(error);
  }
  redirect(`${INBOX}?saved=rejected`);
}
