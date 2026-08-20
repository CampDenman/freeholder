// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { ownerFacing } from "./action-helpers";
import {
  determineContribution,
  setHubEnabled,
  submitContribution,
  updateContributeSettings,
} from "@/core/contribute/service";

export interface ContributeActionState {
  error?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitContributionAction(
  _prev: ContributeActionState,
  form: FormData,
): Promise<ContributeActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  try {
    const filed = await submitContribution.call(
      {
        kind: text(form, "kind") as
          | "bug"
          | "feature"
          | "patch"
          | "docs"
          | "question",
        title: text(form, "title"),
        body: text(form, "body"),
        email: text(form, "email") || undefined,
        name: text(form, "name") || undefined,
        externalUrl: text(form, "externalUrl") || undefined,
        includeDoctor: form.get("includeDoctor") === "on",
        dcoAttested: form.get("dcoAttested") === "on",
        dcoSigner: text(form, "dcoSigner") || undefined,
      },
      actor,
    );
    revalidatePath("/admin/contribute");
    redirect(`/admin/contribute/${filed.id}`);
  } catch (error) {
    if (typeof error === "object" && error && "digest" in error) throw error;
    if (error instanceof ServiceError) {
      return { error: ownerFacing(error.message) };
    }
    throw error;
  }
}

export async function determineContributionAction(
  _prev: ContributeActionState,
  form: FormData,
): Promise<ContributeActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  try {
    await determineContribution.call(
      {
        id: text(form, "id"),
        status: text(form, "status") as
          | "triage"
          | "needs_info"
          | "accepted"
          | "duplicate"
          | "wontfix"
          | "shipped",
        note: text(form, "note") || undefined,
        checklistId: text(form, "checklistId") || undefined,
        parentId: text(form, "parentId") || undefined,
      },
      actor,
    );
    revalidatePath("/admin/contribute");
    return {};
  } catch (error) {
    if (error instanceof ServiceError) {
      return { error: ownerFacing(error.message) };
    }
    throw error;
  }
}

export async function setHubEnabledAction(
  _prev: ContributeActionState,
  form: FormData,
): Promise<ContributeActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  try {
    await setHubEnabled.call(
      { enabled: text(form, "enabled") === "true" },
      actor,
    );
    revalidatePath("/admin/contribute");
    return {};
  } catch (error) {
    if (error instanceof ServiceError) {
      return { error: ownerFacing(error.message) };
    }
    throw error;
  }
}

export async function updateContributeSettingsAction(
  _prev: ContributeActionState,
  form: FormData,
): Promise<ContributeActionState> {
  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  try {
    await updateContributeSettings.call(
      {
        hubEnabled: form.get("hubEnabled") === "on",
        hubUrl: text(form, "hubUrl"),
      },
      actor,
    );
    revalidatePath("/admin/contribute");
    return {};
  } catch (error) {
    if (error instanceof ServiceError) {
      return { error: ownerFacing(error.message) };
    }
    throw error;
  }
}
