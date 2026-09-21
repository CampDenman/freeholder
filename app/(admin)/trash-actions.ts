// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { restoreNote, purgeNote } from "@/core/notes/service";
import { restoreTask, purgeTask } from "@/core/tasks/service";
import { restorePage, purgePage } from "@/modules/cms/service";
import { restoreForm, purgeForm } from "@/modules/forms/service";
import { restorePopup, purgePopup } from "@/modules/popups/service";
import { restoreSegment, purgeSegment } from "@/core/segments/service";
import { restoreView, purgeView } from "@/core/views/service";
import { ServiceError } from "@/core/service";
import { subjectHref } from "@/core/subjects";
import { requireStaffActor } from "./admin/guard";
import { getT } from "../i18n";

const KINDS = ["notes", "tasks", "pages", "forms", "popups", "segments", "views"] as const;
const selection = z.object({ kind: z.enum(KINDS), id: z.uuid(), operation: z.enum(["restore", "purge"]) });

const RESTORE = {
  notes: restoreNote,
  tasks: restoreTask,
  pages: restorePage,
  forms: restoreForm,
  popups: restorePopup,
  segments: restoreSegment,
  views: restoreView,
} as const;

const PURGE = {
  notes: purgeNote,
  tasks: purgeTask,
  pages: purgePage,
  forms: purgeForm,
  popups: purgePopup,
  segments: purgeSegment,
  views: purgeView,
} as const;

/** Where each family surfaces again, so a restore updates what it came from. */
const FAMILY_PATHS: Record<(typeof KINDS)[number], string[]> = {
  notes: ["/admin/contacts"],
  tasks: ["/admin/tasks"],
  pages: ["/admin/pages"],
  forms: ["/admin/forms"],
  popups: ["/admin/popups"],
  segments: ["/admin/segments"],
  views: [],
};

export async function recoverRecordAction(form: FormData): Promise<void> {
  const actor = await requireStaffActor();
  const t = await getT();
  const parsed = selection.safeParse({ kind: form.get("kind"), id: form.get("id"), operation: form.get("operation") });
  if (!parsed.success) redirect(`/admin/trash?error=${encodeURIComponent(t("records.trash.failed"))}`);
  const input = parsed.data;
  const path = `/admin/trash?kind=${input.kind}`;
  const purge = input.operation === "purge";
  try {
    if (purge) {
      const confirmation = z.literal("PURGE").parse(form.get("confirmation"));
      await PURGE[input.kind].call({ id: input.id, confirmation }, actor);
    } else if (input.kind === "notes") {
      const record = await restoreNote.call({ id: input.id }, actor);
      if (record.subjectType && record.subjectId) {
        revalidatePath(subjectHref(record.subjectType, record.subjectId));
      }
    } else if (input.kind === "tasks") {
      const record = await restoreTask.call({ id: input.id }, actor);
      if (record.subjectType && record.subjectId) {
        revalidatePath(subjectHref(record.subjectType, record.subjectId));
      }
    } else {
      await RESTORE[input.kind].call({ id: input.id }, actor);
    }
  } catch (error) {
    const key = error instanceof z.ZodError ? "invalidConfirmation"
      : error instanceof ServiceError && error.code === "step_up_required" ? "verify"
      : error instanceof ServiceError && error.code === "conflict" ? (purge ? "blocked" : "restoreBlocked")
      : error instanceof ServiceError && error.code === "permission" ? "denied" : "failed";
    const message = t(`records.trash.${key}`);
    redirect(`${path}&error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/admin/trash");
  for (const familyPath of FAMILY_PATHS[input.kind]) revalidatePath(familyPath);
  redirect(`${path}&saved=${purge ? "purged" : "restored"}`);
}
