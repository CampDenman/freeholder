// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  applyProposal,
  propose,
  rejectProposal,
  rollbackProposal,
} from "@/modules/builder/service";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function problem(error: unknown): string {
  if (error instanceof ServiceError || error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}

function builderUrl(id?: string, notice?: string, error?: string): string {
  const query = new URLSearchParams();
  if (id) query.set("proposal", id);
  if (notice) query.set("notice", notice);
  if (error) query.set("error", error);
  const encoded = query.toString();
  return `/admin/builder${encoded ? `?${encoded}` : ""}`;
}

export async function proposeSiteAction(form: FormData): Promise<void> {
  let destination: string;
  try {
    const row = await propose.call({ brief: text(form, "brief") }, await actor());
    destination = builderUrl(row.id, "Proposal ready for review.");
  } catch (error) {
    destination = builderUrl(undefined, undefined, problem(error));
  }
  redirect(destination);
}

export async function applyProposalAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  let destination: string;
  try {
    const result = await applyProposal.call({ id }, await actor());
    revalidatePath("/", "layout");
    destination = builderUrl(
      id,
      result.applied ? "The approved proposal is live." : result.message,
    );
  } catch (error) {
    destination = builderUrl(id, undefined, problem(error));
  }
  redirect(destination);
}

export async function rejectProposalAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  let destination: string;
  try {
    await rejectProposal.call({ id }, await actor());
    destination = builderUrl(id, "Proposal discarded without changing the site.");
  } catch (error) {
    destination = builderUrl(id, undefined, problem(error));
  }
  redirect(destination);
}

export async function rollbackProposalAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  let destination: string;
  try {
    const result = await rollbackProposal.call({ id }, await actor());
    revalidatePath("/", "layout");
    destination = "message" in result
      ? builderUrl(id, result.message)
      : builderUrl(result.id, "The proposal was rolled back in one transaction.");
  } catch (error) {
    destination = builderUrl(id, undefined, problem(error));
  }
  redirect(destination);
}
