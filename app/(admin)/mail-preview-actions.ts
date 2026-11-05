// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The preview outbox's one action (C3.36). Opening a held message is the
// audited `mail.openHeld` service, exactly as it is over HTTP: this file only
// carries the signed-in person and hands back the body to show.
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { openHeldMail } from "@/core/mail/preview";
import { ServiceError } from "@/core/service";
import { ownerFacing } from "./action-helpers";

export interface HeldMailState {
  error?: string;
  opened?: { subject: string; recipient: string; text: string };
}

export async function openHeldMailAction(
  _previous: HeldMailState,
  form: FormData,
): Promise<HeldMailState> {
  const id = form.get("id");
  try {
    const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
    const opened = await openHeldMail.call(
      { id: typeof id === "string" ? id : "" },
      { ...actor, request: requestMetadataFromHeaders(await headers()) },
    );
    return { opened: { subject: opened.subject, recipient: opened.recipient, text: opened.text } };
  } catch (error) {
    if (error instanceof ServiceError) return { error: ownerFacing(error.message) };
    console.error("opening held preview mail failed", error);
    return { error: "Something went wrong. Try again." };
  }
}
