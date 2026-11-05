// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// One form's submissions, and its quarantine queue (MASTER.md §4.6, §36).
//
// The queue is the point. A spam filter that deletes is a filter an owner
// cannot audit, and the day it is wrong they never learn what they missed —
// so everything is kept, flagged, and rescuable in one click.
import { ArrowLeft, Paperclip, User, Warning } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";
import { formatDateTime } from "@/core/i18n";
import { listForms, listSubmissionFiles, listSubmissions } from "@/modules/forms/service";
import { isFileAnswer } from "@/modules/forms/fields";
import { currentBusiness } from "@/core/settings/read";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import { hasModuleAccess } from "@/core/service";
import { reviewSubmissionAction } from "../../../forms-actions";

export const dynamic = "force-dynamic";

type Status = "received" | "spam" | "all";

/**
 * A stored answer, as text.
 *
 * The column is jsonb, so a value that predates a field's kind changing — or
 * one an import wrote — may be any JSON at all. Rendering it through
 * String() would show an owner "[object Object]" where somebody's answer
 * should be.
 */
function answerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A file answer: its name, its size, and the owner-only download. */
function FileAnswerLink({
  href,
  filename,
  size,
  label,
  gone,
}: {
  href: string | undefined;
  filename: string;
  size: string;
  label: string;
  gone: string;
}) {
  // No link means the attachment was erased; the name stays as the record.
  if (!href) {
    return (
      <span>
        {filename} <span className="text-ink-muted">({gone})</span>
      </span>
    );
  }
  return (
    <a
      href={`/admin/forms/files/${href}`}
      className="inline-flex items-center gap-1.5 font-medium text-accent"
    >
      <Paperclip size={14} weight="bold" aria-hidden="true" />
      <span>
        {label}: {filename}
      </span>
      <span className="text-xs text-ink-muted">({size})</span>
    </a>
  );
}

export default async function FormSubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requireStaffActor("forms");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const status: Status =
    query.status === "spam" || query.status === "all" ? query.status : "received";

  const [forms, submissions, business, t] = await Promise.all([
    listForms.call({}, actor),
    listSubmissions.call({ formId: id, status }, actor),
    currentBusiness(),
    getT(),
  ]);

  const form = forms.find((row) => row.id === id);
  if (!form) notFound();
  // C3.38: a file answer opens through its attachment, never a public URL.
  const attached = await listSubmissionFiles.call(
    { submissionIds: submissions.map((submission) => submission.id) },
    actor,
  );
  const fileLink = new Map(
    attached.map((file) => [`${file.submissionId}:${file.fieldKey}`, file.id]),
  );

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "forms", "manage");
  const fields = Array.isArray(form.fields)
    ? (form.fields as Array<{ key: string; label: string }>)
    : [];

  return (
    <div className="grid gap-6">
      <div>
        <a
          href="/admin/forms"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted"
        >
          <ArrowLeft size={14} weight="bold" />
          {t("forms.back")}
        </a>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight">{form.name}</h1>
          {canManage ? (
            <a
              href={`/admin/forms/${id}/edit`}
              className="text-sm font-semibold text-accent"
            >
              {t("forms.builder.edit")}
            </a>
          ) : null}
        </div>
      </div>

      <nav aria-label={t("forms.title")} className="flex flex-wrap gap-2">
        {(["received", "spam", "all"] as const).map((value) => (
          <a
            key={value}
            href={`/admin/forms/${id}?status=${value}`}
            aria-current={status === value ? "page" : undefined}
            className={
              status === value
                ? "rounded-md bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent"
                : "rounded-md px-3 py-1.5 text-sm text-ink-muted"
            }
          >
            {value === "received"
              ? t("forms.received")
              : value === "spam"
                ? t("forms.spam")
                : t("forms.all")}
          </a>
        ))}
      </nav>

      {submissions.length === 0 ? (
        <Card>
          <p className="p-4 text-sm text-ink-muted">{t("forms.noSubmissions")}</p>
        </Card>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {submissions.map((submission) => {
            const data = submission.data as Record<string, unknown>;
            return (
              <li key={submission.id}>
                <Card>
                  <div className="grid gap-3 p-4">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <time
                        dateTime={submission.createdAt.toISOString()}
                        className="font-mono text-xs text-ink-muted tabular-nums"
                      >
                        {formatDateTime(submission.createdAt, timezone, locale)}
                      </time>
                      {submission.status === "spam" ? (
                        <Pill tone="warning">
                          <Warning size={12} weight="bold" />
                          {t("forms.spam")}
                        </Pill>
                      ) : null}
                      {submission.contactId ? (
                        <a
                          href={`/admin/contacts/${submission.contactId}`}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent"
                        >
                          <User size={12} weight="bold" />
                          {t("forms.viewContact")}
                        </a>
                      ) : null}
                      <form
                        action={reviewSubmissionAction}
                        className="ms-auto"
                      >
                        <input type="hidden" name="id" value={submission.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={submission.status === "spam" ? "received" : "spam"}
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-rule px-3 py-1.5 text-xs font-medium text-ink"
                        >
                          {submission.status === "spam"
                            ? t("forms.markReceived")
                            : t("forms.markSpam")}
                        </button>
                      </form>
                    </div>

                    {submission.spamReasons.length > 0 ? (
                      <p className="text-xs text-ink-muted">
                        {t("forms.whyFlagged")}: {submission.spamReasons.join("; ")}
                      </p>
                    ) : null}

                    <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                      {fields.map((field) => {
                        const value = data[field.key];
                        if (value === undefined || value === "") return null;
                        return (
                          <div key={field.key} className="contents">
                            <dt className="text-xs font-medium text-ink-muted">
                              {field.label}
                            </dt>
                            <dd className="whitespace-pre-wrap text-sm text-ink">
                              {isFileAnswer(value) ? (
                                <FileAnswerLink
                                  href={fileLink.get(`${submission.id}:${field.key}`)}
                                  filename={value.filename}
                                  size={formatBytes(value.bytes)}
                                  label={t("forms.file.open")}
                                  gone={t("forms.file.gone")}
                                />
                              ) : (
                                answerText(value)
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
