// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { findMeStillContactId } from "@/core/findmestill/discovery";
import {
  checkFindMeStillBookingLink, linkFindMeStillCustomer, pinFindMeStillDesk, publishFindMeStillDesk,
  setFindMeStillDeskGrant,
} from "@/core/findmestill/service";
import { hasModuleAccess, ServiceError } from "@/core/service";
import { requireStaffActor } from "../guard";

const route = "/admin/findmestill";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function deskUrl(identity: string, status: string): string {
  const params = new URLSearchParams({ status });
  if (findMeStillContactId.safeParse(identity).success) params.set("desk", identity);
  return `${route}?${params}`;
}

function refused(error: unknown, identity: string): never {
  if (!(error instanceof ServiceError)) throw error;
  redirect(deskUrl(identity, error.code === "step_up_required" ? "verify" : "refused"));
}

async function documents(form: FormData): Promise<string[]> {
  const pasted = text(form, "document");
  const attachments = form.getAll("documents").filter((value): value is File => typeof value !== "string" && value.size > 0);
  const count = attachments.length + (pasted.trim() ? 1 : 0);
  if (count < 1 || count > 3 || attachments.some((file) => file.size > 262_144)) {
    throw new ServiceError("validation", "Supply up to three bounded public card documents.");
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return [...(pasted.trim() ? [pasted] : []), ...await Promise.all(attachments.map(async (file) => decoder.decode(await file.arrayBuffer())))];
  } catch {
    throw new ServiceError("validation", "The public card document is not valid UTF-8.");
  }
}

export async function saveCardAction(form: FormData): Promise<void> {
  const actor = await requireStaffActor("findMeStill", "manage");
  const identity = text(form, "identity").trim();
  const publish = text(form, "intent") === "publish";
  let status;
  try {
    const supplied = await documents(form);
    if (publish) {
      if (supplied.length !== 1) throw new ServiceError("validation", "Publish one signed document.");
      await publishFindMeStillDesk.call({ identity, document: supplied[0]! }, actor);
      status = "published";
    } else {
      const result = await pinFindMeStillDesk.call({ identity, documents: supplied }, actor);
      status = result.saveStatus;
    }
  } catch (error) {
    refused(error, identity);
  }
  revalidatePath(route);
  redirect(deskUrl(identity, status));
}

export async function setGrantAction(form: FormData): Promise<void> {
  const actor = await requireStaffActor("findMeStill", "manage");
  const identity = text(form, "identity");
  const day = text(form, "expiry");
  const revoke = text(form, "intent") === "revoke";
  try {
    await setFindMeStillDeskGrant.call({ identity, userId: text(form, "userId"),
      grant: revoke ? null : { expiresAt: day ? `${day}T00:00:00Z` : null },
    }, actor);
  } catch (error) {
    refused(error, identity);
  }
  revalidatePath(route);
  redirect(deskUrl(identity, revoke ? "revoked" : "granted"));
}

export async function linkCustomerAction(form: FormData): Promise<void> {
  const actor = await requireStaffActor("findMeStill", "manage");
  const identity = text(form, "identity");
  try {
    await linkFindMeStillCustomer.call({ identity, contactId: text(form, "contactId") || null }, actor);
  } catch (error) {
    refused(error, identity);
  }
  revalidatePath(route);
  redirect(deskUrl(identity, "linked"));
}

export async function openBookingAction(form: FormData): Promise<void> {
  const actor = await requireStaffActor("findMeStill");
  const identity = text(form, "identity");
  let bookingId: string;
  try {
    if (!hasModuleAccess(actor, "scheduling")) throw new ServiceError("permission", "Scheduling access is required.");
    const link = await checkFindMeStillBookingLink.call({ identity, contactId: text(form, "contactId"),
      bookingId: text(form, "bookingId"),
    }, actor);
    bookingId = link.bookingId;
  } catch (error) {
    refused(error, identity);
  }
  redirect(`/admin/appointments/${bookingId}`);
}
