// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { restoreNote, purgeNote } from "@/core/notes/service";
import { restoreTask, purgeTask } from "@/core/tasks/service";
import { ServiceError } from "@/core/service";
import { subjectHref } from "@/core/subjects";
import { requireStaffActor } from "./admin/guard";
import { getT } from "../i18n";

const selection = z.object({ kind: z.enum(["notes", "tasks"]), id: z.uuid(), operation: z.enum(["restore", "purge"]) });

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
      if (input.kind === "notes") await purgeNote.call({ id: input.id, confirmation }, actor);
      else await purgeTask.call({ id: input.id, confirmation }, actor);
    } else {
      const record = input.kind === "notes"
        ? await restoreNote.call({ id: input.id }, actor)
        : await restoreTask.call({ id: input.id }, actor);
      if (record.subjectType && record.subjectId) revalidatePath(subjectHref(record.subjectType, record.subjectId));
    }
  } catch (error) {
    const key = error instanceof z.ZodError ? "invalidConfirmation"
      : error instanceof ServiceError && error.code === "step_up_required" ? "verify"
      : error instanceof ServiceError && error.code === "conflict" ? "blocked"
      : error instanceof ServiceError && error.code === "permission" ? "denied" : "failed";
    const message = t(`records.trash.${key}`);
    redirect(`${path}&error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/admin/trash");
  revalidatePath("/admin/tasks");
  redirect(`${path}&saved=${purge ? "purged" : "restored"}`);
}
