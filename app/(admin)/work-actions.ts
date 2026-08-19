// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  assignTask,
  cancelTask,
  createTask,
  flagTask,
  reopenTask,
  updateTask,
} from "@/core/agents/service";

export interface WorkActionState {
  error?: string;
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function ownerFacing(message: string): string {
  return message.replace(/^[a-z][\w.]*: (?:[\w.[\]]+: )?/, "");
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
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
