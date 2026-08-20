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
  assignTask,
  cancelTask,
  createTask,
  flagTask,
  inspectRun,
  pauseAgent,
  pauseAllAgents,
  reopenTask,
  retryTask,
  stopRun,
  tailRun,
  updateTask,
} from "@/core/agents/service";

export interface WorkActionState {
  error?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * Pause or resume one worker, or every worker at once (C4.07).
 *
 * Plain form posts rather than a client component: the kill switch has to
 * work on a page whose JavaScript never arrived, which is the moment an owner
 * is most likely to want it.
 */
export async function pauseAgentAction(form: FormData): Promise<void> {
  const paused = text(form, "paused") !== "false";
  const id = text(form, "id");
  try {
    if (id) {
      await pauseAgent.call({ id, paused }, await actor());
    } else {
      await pauseAllAgents.call({ paused }, await actor());
    }
  } catch {
    redirect("/admin/work?error=pause");
  }
  revalidatePath("/admin/work");
  redirect(`/admin/work?saved=${paused ? "paused" : "resumed"}`);
}

export async function createTaskAction(
  _prev: WorkActionState,
  form: FormData,
): Promise<WorkActionState> {
  try {
    const created = await createTask.call(
      {
        title: text(form, "title"),
        brief: text(form, "brief"),
        agentId: text(form, "agentId") || undefined,
        priority: Number(text(form, "priority") || "3"),
        dueAt: text(form, "dueAt") ? new Date(text(form, "dueAt")).toISOString() : undefined,
        parentId: text(form, "parentId") || undefined,
        dependsOn: text(form, "dependsOn")
          ? text(form, "dependsOn")
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
      },
      await actor(),
    );
    revalidatePath("/admin/work");
    redirect(`/admin/work/${created.id}`);
  } catch (error) {
    return {
      error: error instanceof ServiceError ? ownerFacing(error.message) : "That task could not be created.",
    };
  }
}

export async function updateTaskAction(
  _prev: WorkActionState,
  form: FormData,
): Promise<WorkActionState> {
  try {
    const id = text(form, "id");
    const due = text(form, "dueAt");
    await updateTask.call(
      {
        id,
        title: text(form, "title") || undefined,
        brief: text(form, "brief") || undefined,
        priority: Number(text(form, "priority") || "3"),
        dueAt: due ? new Date(due).toISOString() : null,
      },
      await actor(),
    );
    revalidatePath("/admin/work");
    revalidatePath(`/admin/work/${id}`);
    return {};
  } catch (error) {
    return {
      error: error instanceof ServiceError ? ownerFacing(error.message) : "That task could not be updated.",
    };
  }
}

export async function assignTaskAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  await assignTask.call(
    { id, agentId: text(form, "agentId") || null },
    await actor(),
  );
  revalidatePath("/admin/work");
  revalidatePath(`/admin/work/${id}`);
}

export async function flagTaskAction(
  _prev: WorkActionState,
  form: FormData,
): Promise<WorkActionState> {
  try {
    const id = text(form, "id");
    await flagTask.call({ id, reason: text(form, "reason") }, await actor());
    revalidatePath("/admin/work");
    revalidatePath(`/admin/work/${id}`);
    return {};
  } catch (error) {
    return {
      error: error instanceof ServiceError ? ownerFacing(error.message) : "That task could not be flagged.",
    };
  }
}

export async function reopenTaskAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  await reopenTask.call({ id }, await actor());
  revalidatePath("/admin/work");
  revalidatePath(`/admin/work/${id}`);
}

export async function cancelTaskAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  await cancelTask.call({ id, reason: text(form, "reason") || undefined }, await actor());
  revalidatePath("/admin/work");
  revalidatePath(`/admin/work/${id}`);
}

export async function stopRunAction(form: FormData): Promise<void> {
  const runId = text(form, "runId");
  const stopped = await stopRun.call(
    { runId, reason: text(form, "reason") || undefined },
    await actor(),
  );
  revalidatePath("/admin/work");
  revalidatePath(`/admin/work/${stopped.taskId}`);
}

export async function retryTaskAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  await retryTask.call({ id }, await actor());
  revalidatePath("/admin/work");
  revalidatePath(`/admin/work/${id}`);
}

export async function tailRunAction(runId: string, afterSeq: number) {
  return tailRun.call({ runId, afterSeq }, await actor());
}

export async function inspectRunAction(runId: string) {
  return inspectRun.call({ runId }, await actor());
}
