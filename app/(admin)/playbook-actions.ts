// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the playbooks screen (C4.08). Validation, versioning and
// the trigger rules live in the services shared with HTTP and MCP.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  createPlaybook,
  deletePlaybook,
  importPlaybook,
  runPlaybook,
  updatePlaybook,
} from "@/core/agents/playbooks";
import { setPlaybookSchedule } from "@/core/agents/playbook-schedule";
import { ownerFacing } from "./action-helpers";

export interface PlaybookActionState {
  error?: string;
}

const PLAYBOOKS = "/admin/work/playbooks";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** `customer:Customer:string:required` per line — a form an owner can type. */
function parseParams(raw: string) {
  const params = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, label, type, ...flags] = line.split(":").map((part) => part.trim());
      const choices = flags.filter((flag) => flag && flag !== "required");
      return {
        name: name ?? "",
        label: label || name || "",
        type: (["string", "text", "number", "boolean", "choice"].includes(type ?? "")
          ? type
          : "string") as "string" | "text" | "number" | "boolean" | "choice",
        required: flags.includes("required"),
        choices,
      };
    });
  return { params };
}

export async function createPlaybookAction(
  _prev: PlaybookActionState,
  form: FormData,
): Promise<PlaybookActionState> {
  try {
    const trigger = text(form, "trigger") as "manual" | "schedule" | "event";
    await createPlaybook.call(
      {
        name: text(form, "name"),
        description: text(form, "description"),
        briefTemplate: text(form, "briefTemplate"),
        paramsSchema: parseParams(text(form, "params")),
        trigger: trigger || "manual",
        scheduleCron: text(form, "scheduleCron") || undefined,
        eventPattern: text(form, "eventPattern") || undefined,
        autonomyCeiling:
          (text(form, "autonomyCeiling") as "suggest" | "approve" | "autonomous") ||
          undefined,
        budgetCents: text(form, "budgetCents") ? Number(text(form, "budgetCents")) : undefined,
        note: "Created.",
      },
      await actor(),
    );
  } catch (error) {
    return {
      error:
        error instanceof ServiceError
          ? ownerFacing(error.message)
          : "That playbook could not be saved.",
    };
  }
  revalidatePath(PLAYBOOKS);
  redirect(`${PLAYBOOKS}?saved=created`);
}

export async function runPlaybookAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  let taskId: string;
  try {
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("param.") && typeof value === "string") {
        params[key.slice("param.".length)] = value;
      }
    }
    const started = await runPlaybook.call({ id, params }, await actor());
    taskId = started.taskId;
  } catch (error) {
    const message = error instanceof ServiceError ? error.code : "failed";
    redirect(`${PLAYBOOKS}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/work/${taskId}`);
}

export async function togglePlaybookAction(form: FormData): Promise<void> {
  try {
    await updatePlaybook.call(
      { id: text(form, "id"), enabled: text(form, "enabled") === "true" },
      await actor(),
    );
  } catch {
    redirect(`${PLAYBOOKS}?error=toggle`);
  }
  revalidatePath(PLAYBOOKS);
  redirect(PLAYBOOKS);
}

/**
 * Set when a playbook runs (C4.14).
 *
 * The refusal is shown rather than swallowed: "0 9 * * *" and "every morning"
 * look equally reasonable to somebody typing one, and a schedule that silently
 * did not save is a briefing that silently never arrives.
 */
export async function schedulePlaybookAction(form: FormData): Promise<void> {
  const timezone = text(form, "timezone");
  try {
    await setPlaybookSchedule.call(
      {
        id: text(form, "id"),
        cron: text(form, "cron"),
        timezone: timezone || undefined,
        catchUp: text(form, "catchUp") === "true",
      },
      await actor(),
    );
  } catch (error) {
    const message =
      error instanceof ServiceError ? ownerFacing(error.message) : "schedule";
    redirect(`${PLAYBOOKS}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(PLAYBOOKS);
  redirect(`${PLAYBOOKS}?saved=scheduled`);
}

export async function deletePlaybookAction(form: FormData): Promise<void> {
  try {
    await deletePlaybook.call({ id: text(form, "id") }, await actor());
  } catch {
    redirect(`${PLAYBOOKS}?error=delete`);
  }
  revalidatePath(PLAYBOOKS);
  redirect(`${PLAYBOOKS}?saved=deleted`);
}

export async function importPlaybookAction(
  _prev: PlaybookActionState,
  form: FormData,
): Promise<PlaybookActionState> {
  try {
    const document: unknown = JSON.parse(text(form, "document"));
    await importPlaybook.call(
      { document: document as never, name: text(form, "name") || undefined },
      await actor(),
    );
  } catch (error) {
    return {
      error:
        error instanceof ServiceError
          ? ownerFacing(error.message)
          : "That does not look like a playbook document.",
    };
  }
  revalidatePath(PLAYBOOKS);
  redirect(`${PLAYBOOKS}?saved=imported`);
}
