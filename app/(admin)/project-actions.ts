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
  attachFile,
  createProject,
  linkToProject,
  removeTask,
  setOutcome,
  setTaskStatus,
  unlinkFromProject,
  updateProject,
} from "@/modules/projects/service";
import {
  addTestimonial,
  detachFile,
  publishCaseStudy,
  recordProjectConsent,
  removeOutcome,
  revokeProjectConsent,
  saveCaseStudy,
  setTestimonialStatus,
  unpublishCaseStudy,
  updateCaseStudySettings,
} from "@/modules/projects/publishing-service";
import type { EditorNode } from "./admin/BlockEditor";
import {
  addProjectToCollection,
  createCollection,
  publishCollection,
  removeProjectFromCollection,
  unpublishCollection,
  updateCollection,
} from "@/modules/projects/portfolio-service";
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
        serviceProductIds: form
          .getAll("serviceProductId")
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${id}`, "That could not be saved.");
  }
  revalidatePath(`${PROJECTS}/${id}`);
  redirect(`${PROJECTS}/${id}?saved=details`);
}

export async function saveProjectBlocksAction(
  id: string,
  expectedVersion: number,
  blocks: EditorNode[],
): Promise<{ error?: string; version?: number; conflict?: boolean }> {
  try {
    const saved = await saveCaseStudy.call(
      { id, expectedVersion, blocks },
      await actor(),
    );
    revalidatePath(`${PROJECTS}/${id}`);
    return { version: saved.version };
  } catch (error) {
    return {
      error: error instanceof Error ? ownerFacing(error.message) : "That draft could not be saved.",
      conflict: error instanceof ServiceError && error.code === "conflict",
    };
  }
}

export async function updateCaseStudySettingsAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    await updateCaseStudySettings.call(
      {
        id,
        coverAssetId: text(form, "coverAssetId") || null,
        featured: form.get("featured") === "on",
        seo: {
          ...(text(form, "seoTitle") ? { title: text(form, "seoTitle") } : {}),
          ...(text(form, "seoDescription")
            ? { description: text(form, "seoDescription") }
            : {}),
        },
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${id}`, "Those publishing settings could not be saved.");
  }
  revalidatePath(`${PROJECTS}/${id}`);
  redirect(`${PROJECTS}/${id}?saved=publishing`);
}

export async function projectConsentAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    if (text(form, "intent") === "revoke") {
      await revokeProjectConsent.call({ id }, await actor());
    } else {
      await recordProjectConsent.call(
        {
          id,
          method: text(form, "method") as "contract" | "email" | "written" | "verbal" | "other",
          note: text(form, "note") || null,
        },
        await actor(),
      );
    }
  } catch (error) {
    refused(error, `${PROJECTS}/${id}`, "That permission record could not be changed.");
  }
  revalidatePath(`${PROJECTS}/${id}`);
  redirect(`${PROJECTS}/${id}?saved=consent`);
}

export async function projectPublicationAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  try {
    if (text(form, "intent") === "unpublish") {
      await unpublishCaseStudy.call({ id }, await actor());
    } else {
      await publishCaseStudy.call({ id }, await actor());
    }
  } catch (error) {
    refused(error, `${PROJECTS}/${id}`, "That case study could not be published.");
  }
  revalidatePath(`${PROJECTS}/${id}`);
  revalidatePath("/portfolio");
  redirect(`${PROJECTS}/${id}?saved=publication`);
}

export async function attachProjectFileAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await attachFile.call(
      {
        projectId,
        assetId: text(form, "assetId"),
        role: text(form, "role") as "hero" | "gallery" | "before" | "after" | "process" | "detail" | "document",
        pairKey: text(form, "pairKey") || null,
        caption: text(form, "caption") || null,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That file could not be attached.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=media`);
}

export async function detachProjectFileAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await detachFile.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That file could not be detached.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=media`);
}

export async function removeOutcomeAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await removeOutcome.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That outcome could not be removed.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=outcome`);
}

export async function addTestimonialAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  const rating = Number.parseInt(text(form, "rating"), 10);
  try {
    await addTestimonial.call(
      {
        projectId,
        contactId: text(form, "contactId"),
        displayName: text(form, "displayName"),
        role: text(form, "role") || null,
        body: text(form, "body"),
        rating: Number.isInteger(rating) ? rating : null,
        consentMethod: text(form, "consentMethod") as "contract" | "email" | "written" | "verbal" | "other",
        consentNote: text(form, "consentNote") || null,
        displayLocations: form
          .getAll("displayLocation")
          .filter((value): value is "project" | "service" | "portfolio" =>
            value === "project" || value === "service" || value === "portfolio",
          ),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That testimonial could not be added.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=testimonial`);
}

export async function testimonialStatusAction(form: FormData): Promise<void> {
  const projectId = text(form, "projectId");
  try {
    await setTestimonialStatus.call(
      {
        id: text(form, "id"),
        status: text(form, "status") as "draft" | "published" | "withdrawn",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${PROJECTS}/${projectId}`, "That testimonial could not be changed.");
  }
  revalidatePath(`${PROJECTS}/${projectId}`);
  redirect(`${PROJECTS}/${projectId}?saved=testimonial`);
}

export async function createCollectionAction(form: FormData): Promise<void> {
  const path = `${PROJECTS}/collections`;
  let id: string;
  try {
    const created = await createCollection.call(
      {
        name: text(form, "name"),
        kind: text(form, "kind") as "portfolio" | "service" | "industry" | "season",
        description: text(form, "description") || null,
        position: Number.parseInt(text(form, "position") || "0", 10),
      },
      await actor(),
    );
    id = created.id;
  } catch (error) {
    refused(error, path, "That collection could not be created.");
  }
  revalidatePath(path);
  redirect(`${path}/${id}`);
}

export async function updateCollectionAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const path = `${PROJECTS}/collections/${id}`;
  try {
    await updateCollection.call(
      {
        id,
        name: text(form, "name"),
        kind: text(form, "kind") as "portfolio" | "service" | "industry" | "season",
        description: text(form, "description") || null,
        coverAssetId: text(form, "coverAssetId") || null,
        position: Number.parseInt(text(form, "position") || "0", 10),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, path, "That collection could not be saved.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=details`);
}

export async function collectionMembershipAction(form: FormData): Promise<void> {
  const collectionId = text(form, "collectionId");
  const path = `${PROJECTS}/collections/${collectionId}`;
  try {
    if (text(form, "intent") === "remove") {
      await removeProjectFromCollection.call({ id: text(form, "id") }, await actor());
    } else {
      await addProjectToCollection.call(
        {
          collectionId,
          projectId: text(form, "projectId"),
          position: Number.parseInt(text(form, "position") || "0", 10),
        },
        await actor(),
      );
    }
  } catch (error) {
    refused(error, path, "That collection membership could not be changed.");
  }
  revalidatePath(path);
  redirect(`${path}?saved=projects`);
}

export async function collectionPublicationAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const path = `${PROJECTS}/collections/${id}`;
  try {
    if (text(form, "intent") === "unpublish") {
      await unpublishCollection.call({ id }, await actor());
    } else {
      await publishCollection.call({ id }, await actor());
    }
  } catch (error) {
    refused(error, path, "That collection could not be published.");
  }
  revalidatePath(path);
  revalidatePath("/portfolio");
  redirect(`${path}?saved=publication`);
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
