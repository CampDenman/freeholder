// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the projects workspace (C6.15). The linking, the pairing
// rule and the completion stamp all live in the services.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  addTask,
  createProject,
  linkToProject,
  removeTask,
  setOutcome,
  setTaskStatus,
  unlinkFromProject,
  updateProject,
} from "@/modules/projects/service";
import { ownerFacing } from "./action-helpers";

const PROJECTS = "/admin/projects";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createProjectAction(form: FormData): Promise<void> {
  let created: string;
  try {
    const project = await createProject.call(
      {
        title: text(form, "title"),
        contactId: text(form, "contactId") || null,
        summary: text(form, "summary") || null,
      },
      await actor(),
    );
    created = project.id;
  } catch (error) {
    refused(error, PROJECTS, "That project could not be started.");
  }
  revalidatePath(PROJECTS);
  redirect(`${PROJECTS}/${created}`);
}

export async function updateProjectAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    const status = text(form, "status");
    await updateProject.call(
      {
        id,
        ...(text(form, "title") ? { title: text(form, "title") } : {}),
        summary: text(form, "summary") || null,
        clientDisplayName: text(form, "clientDisplayName") || null,
        ...(status
          ? {
              status: status as
                | "enquiry"
                | "quoted"
                | "active"
                | "on_hold"
                | "complete"
                | "cancelled",
            }
          : {}),
        notes: text(form, "notes") || null,
        occurredOn: text(form, "occurredOn") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${id}`, "That could not be saved.");
  }
  revalidatePath(`${PROJECTS}/${id}`);
  redirect(`${PROJECTS}/${id}?saved=details`);
}

export async function linkAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await linkToProject.call(
      {
        projectId,
        kind: text(form, "kind") as
          | "quote"
          | "contract"
          | "booking"
          | "invoice"
          | "rental"
          | "form_submission",
        targetId: text(form, "targetId"),
        label: text(form, "label") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That could not be attached.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=linked`);
}

export async function unlinkAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await unlinkFromProject.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That could not be removed.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=unlinked`);
}

export async function addTaskAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await addTask.call(
      {
        projectId,
        title: text(form, "title"),
        dueOn: text(form, "dueOn") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That task could not be added.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=task`);
}

export async function setTaskStatusAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await setTaskStatus.call(
      {
        id: text(form, "id"),
        status: text(form, "status") as "todo" | "doing" | "blocked" | "done",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That could not be moved.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=task`);
}

export async function removeTaskAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await removeTask.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That task could not be removed.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=task`);
}

export async function setOutcomeAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await setOutcome.call(
      {
        projectId,
        label: text(form, "label"),
        value: text(form, "value"),
        unit: text(form, "unit") || null,
        // Asked for rather than required, because §4.7's point is that the
        // field being *there* is what makes an owner notice they cannot fill
        // it before they publish the claim.
        method: text(form, "method") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That outcome could not be recorded.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=outcome`);
}
