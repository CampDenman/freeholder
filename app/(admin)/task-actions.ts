// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the work list (C7.02). The recurrence, the subject lookup
// and the reminder reset all live in `core/tasks`, so ticking a task off in
// the browser and ticking it off over the API produce the same next occurrence.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  CADENCES,
  createTask,
  removeTask,
  setTaskStatus,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_SUBJECTS,
  updateTask,
} from "@/core/tasks/service";
import { ownerFacing } from "./action-helpers";

const TASKS = "/admin/tasks";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${TASKS}?error=${encodeURIComponent(message)}`);
}

/** A day from a date input becomes a moment at the end of that day. */
function endOfDay(value: string): string | null {
  return value ? `${value}T23:59:00.000Z` : null;
}

/** A posted string, only if it is one of the values the service accepts. */
function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return values.find((allowed) => allowed === value) ?? null;
}

export async function createTaskAction(form: FormData): Promise<void> {
  try {
    const subjectType = oneOf(TASK_SUBJECTS, text(form, "subjectType"));
    const subjectId = text(form, "subjectId");
    const dueOn = text(form, "dueOn");
    const remindOn = text(form, "remindOn");
    await createTask.call(
      {
        // Both halves or neither: the service refuses a half-written subject
        // rather than storing a task nothing can open.
        subjectType: subjectType && subjectId ? subjectType : null,
        subjectId: subjectType && subjectId ? subjectId : null,
        title: text(form, "title"),
        details: text(form, "details") || null,
        dueAt: endOfDay(dueOn),
        // Nine in the morning, not the end of the day: a reminder that arrives
        // as the deadline passes is not a reminder.
        remindAt: remindOn ? `${remindOn}T09:00:00.000Z` : null,
        assigneeUserId: text(form, "assigneeUserId") || null,
        priority: oneOf(TASK_PRIORITIES, text(form, "priority")) ?? "normal",
        cadence: oneOf(CADENCES, text(form, "cadence")),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That task could not be added.");
  }
  revalidatePath(TASKS);
  redirect(`${TASKS}?saved=created`);
}

export async function setTaskStatusAction(form: FormData): Promise<void> {
  const status = oneOf(TASK_STATUSES, text(form, "status"));
  try {
    if (!status) throw new ServiceError("validation", "That is not a state a task can be in.");
    await setTaskStatus.call({ id: text(form, "id"), status }, await actor());
  } catch (error) {
    refused(error, "That could not be changed.");
  }
  revalidatePath(TASKS);
  redirect(`${TASKS}?saved=${status === "done" ? "done" : "moved"}`);
}

export async function assignTaskAction(form: FormData): Promise<void> {
  try {
    await updateTask.call(
      {
        id: text(form, "id"),
        assigneeUserId: text(form, "assigneeUserId") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That could not be handed over.");
  }
  revalidatePath(TASKS);
  redirect(`${TASKS}?saved=assigned`);
}

export async function removeTaskAction(form: FormData): Promise<void> {
  try {
    await removeTask.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That could not be removed.");
  }
  revalidatePath(TASKS);
  redirect(`${TASKS}?saved=removed`);
}
