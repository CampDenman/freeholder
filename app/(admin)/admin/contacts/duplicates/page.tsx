// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Explainable, human-reviewed duplicate handling (MASTER.md C1.07).
import {
  DUPLICATE_REASON_CODES,
  listContactMergeOperations,
  listDuplicateCandidates,
  type DuplicateReason,
  type DuplicateReasonCode,
} from "@/core/contacts/duplicates";
import { formatDateTime, type Translate } from "@/core/i18n";
import { hasModuleAccess } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import {
  DuplicateReview,
  type DuplicateContactSummary,
  type DuplicateReviewLabels,
} from "./DuplicateReview";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

function pageHref(offset: number): string {
  return offset > 0
    ? `/admin/contacts/duplicates?offset=${offset}`
    : "/admin/contacts/duplicates";
}

function reasonsOf(value: unknown): DuplicateReason[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((reason) => {
    if (!reason || typeof reason !== "object") return [];
    const candidate = reason as Record<string, unknown>;
    if (
      typeof candidate.code !== "string" ||
      !DUPLICATE_REASON_CODES.includes(candidate.code as DuplicateReasonCode) ||
      typeof candidate.points !== "number"
    ) {
      return [];
    }
    return [{
      code: candidate.code as DuplicateReasonCode,
      points: candidate.points,
      ...(typeof candidate.value === "string" ? { value: candidate.value } : {}),
    }];
  });
}

function contactOf(value: unknown, id: string): DuplicateContactSummary {
  if (!value || typeof value !== "object") {
    return { id, name: id, email: null };
  }
  const record = value as Record<string, unknown>;
  return {
    id,
    name: typeof record.name === "string" ? record.name : id,
    email: typeof record.email === "string" ? record.email : null,
  };
}

function reasonLabel(
  t: Translate,
  code: DuplicateReasonCode,
  points: number,
  value?: string,
): string {
  return t(`contacts.duplicates.reason.${code}`, {
    points,
    value: value ?? "",
  });
}

export default async function ContactDuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaffActor("contacts");
  const params = await searchParams;
  const rawOffset = Array.isArray(params.offset) ? params.offset[0] : params.offset;
  const offset = Math.max(0, Number(rawOffset) || 0);
  const [business, t, queue, operations] = await Promise.all([
    currentBusiness(),
    getT(),
    listDuplicateCandidates.call({ limit: PAGE_SIZE, offset }, actor),
    listContactMergeOperations.call({ limit: 20 }, actor),
  ]);
  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const labels: DuplicateReviewLabels = {
    queueTitle: t("contacts.duplicates.queueTitle"),
    queueCount: t("contacts.duplicates.queueCount", { count: queue.total }),
    empty: t("contacts.duplicates.empty"),
    scan: t("contacts.duplicates.scan"),
    noEmail: t("contacts.merge.noEmail"),
    dismiss: t("contacts.duplicates.dismiss"),
    unavailable: t("contacts.duplicates.unavailable"),
    historyTitle: t("contacts.duplicates.historyTitle"),
    historyIntro: t("contacts.duplicates.historyIntro"),
    historyEmpty: t("contacts.duplicates.historyEmpty"),
    undo: t("contacts.duplicates.undo"),
    undoAvailable: t("contacts.duplicates.undoAvailable"),
    undone: t("contacts.duplicates.undone"),
    undoUnavailable: t("contacts.duplicates.undoUnavailable"),
    undoSecurityBlocker: t("contacts.duplicates.undoSecurityBlocker"),
    working: t("contacts.duplicates.working"),
  };

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/contacts" className="text-sm text-ink-muted">
          {t("contacts.duplicates.back")}
        </a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">
          {t("contacts.duplicates.title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          {t("contacts.duplicates.intro")}
        </p>
      </div>

      <DuplicateReview
        canManage={hasModuleAccess(actor, "contacts", "manage")}
        labels={labels}
        pagination={queue.total > PAGE_SIZE ? {
          label: t("contacts.paging", {
            from: offset + 1,
            to: Math.min(offset + PAGE_SIZE, queue.total),
            total: queue.total,
          }),
          previousHref: offset > 0
            ? pageHref(Math.max(0, offset - PAGE_SIZE))
            : null,
          nextHref: offset + PAGE_SIZE < queue.total
            ? pageHref(offset + PAGE_SIZE)
            : null,
          previousLabel: t("common.previous"),
          nextLabel: t("common.next"),
        } : undefined}
        candidates={queue.rows.map((candidate) => ({
          id: candidate.id,
          scoreLabel: t("contacts.duplicates.score", { score: candidate.score }),
          detectedLabel: t("contacts.duplicates.detected", {
            when: formatDateTime(candidate.detectedAt, timezone, locale),
          }),
          reasons: reasonsOf(candidate.reasons).map((reason) => ({
            code: reason.code,
            label: reasonLabel(t, reason.code, reason.points, reason.value),
          })),
          keepALabel: t("contacts.duplicates.keepAndMerge", {
            keep: candidate.contactAName,
            merge: candidate.contactBName,
          }),
          keepBLabel: t("contacts.duplicates.keepAndMerge", {
            keep: candidate.contactBName,
            merge: candidate.contactAName,
          }),
          contactA: {
            id: candidate.contactAId,
            name: candidate.contactAName,
            email: candidate.contactAEmail,
          },
          contactB: {
            id: candidate.contactBId,
            name: candidate.contactBName,
            email: candidate.contactBEmail,
          },
        }))}
        operations={operations.map((operation) => ({
          id: operation.id,
          mergedAt: formatDateTime(operation.mergedAt, timezone, locale),
          undoneAt: operation.undoneAt
            ? formatDateTime(operation.undoneAt, timezone, locale)
            : null,
          undoable: operation.undoable,
          securityCredentialInvalidated: operation.undoBlockers.some((blocker) =>
            blocker.includes("sign-in link"),
          ),
          mergedPairLabel: t("contacts.duplicates.mergedPair", {
            survivor: contactOf(
              operation.survivorBefore,
              operation.survivingContactId,
            ).name,
            duplicate: contactOf(
              operation.duplicateBefore,
              operation.duplicateContactId,
            ).name,
          }),
        }))}
      />
    </div>
  );
}
