// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the assistant screen (C9.21). Every rule — that a provider
// needs a model, that switching on needs a budget, that a scope must exist in
// the catalogue — lives in the services, so a hand-made request is refused by
// exactly the same code the form is.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  deleteKnowledge,
  reindex,
  saveKnowledge,
  setScope,
  updateSettings,
} from "@/modules/assistant/service";
import { ownerFacing } from "./action-helpers";

const ASSISTANT = "/admin/assistant";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, key: string): string | null {
  return text(form, key) || null;
}

/** Whole numbers only; the money gate and §15.4 both forbid the alternative. */
function digits(form: FormData, key: string, fallback: number): number {
  const raw = text(form, key);
  if (!/^\d+$/.test(raw)) return fallback;
  return Number(raw);
}

function optionalDigits(form: FormData, key: string): number | null {
  const raw = text(form, key);
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function done(error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`${ASSISTANT}?error=${encodeURIComponent(ownerFacing(error.message))}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("assistant action failed");
  redirect(`${ASSISTANT}?saved=1`);
}

export async function saveAssistantAction(form: FormData): Promise<void> {
  const provider = text(form, "provider");
  try {
    await updateSettings.call(
      {
        enabled: form.get("enabled") === "1",
        provider: provider === "anthropic" || provider === "openai" ? provider : "none",
        model: optional(form, "model"),
        baseUrl: optional(form, "baseUrl"),
        credentialRef: optional(form, "credentialRef"),
        inputCentsPerMillion: optionalDigits(form, "inputCentsPerMillion"),
        outputCentsPerMillion: optionalDigits(form, "outputCentsPerMillion"),
        maxOutputTokens: digits(form, "maxOutputTokens", 700),
        displayName: optional(form, "displayName"),
        spendCapCents: digits(form, "spendCapCents", 0),
        spendPeriod:
          text(form, "spendPeriod") === "day"
            ? "day"
            : text(form, "spendPeriod") === "week"
              ? "week"
              : "month",
        repliesPerConversation: digits(form, "repliesPerConversation", 20),
        repliesPerHour: digits(form, "repliesPerHour", 60),
      },
      await actor(),
    );
  } catch (error) {
    done(error);
  }
  revalidatePath(ASSISTANT);
  done();
}

export async function saveKnowledgeAction(form: FormData): Promise<void> {
  try {
    await saveKnowledge.call(
      {
        title: text(form, "title"),
        body: text(form, "body"),
        kind: (text(form, "kind") || "fact") as "qa" | "fact" | "policy",
        locale: text(form, "locale") || "en",
        enabled: form.get("enabled") === "1",
      },
      await actor(),
    );
  } catch (error) {
    done(error);
  }
  revalidatePath(ASSISTANT);
  done();
}

export async function deleteKnowledgeAction(form: FormData): Promise<void> {
  try {
    await deleteKnowledge.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    done(error);
  }
  revalidatePath(ASSISTANT);
  done();
}

export async function reindexAssistantAction(): Promise<void> {
  try {
    await reindex.call({}, await actor());
  } catch (error) {
    done(error);
  }
  revalidatePath(ASSISTANT);
  done();
}

export async function setAssistantScopeAction(form: FormData): Promise<void> {
  try {
    await setScope.call(
      { action: text(form, "action"), enabled: form.get("enabled") === "1" },
      await actor(),
    );
  } catch (error) {
    done(error);
  }
  revalidatePath(ASSISTANT);
  done();
}
