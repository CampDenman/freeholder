// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import {
  ArrowsMerge,
  CheckCircle,
  ClockCounterClockwise,
  MagnifyingGlass,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Pill,
} from "@/ui/primitives";
import {
  duplicateReviewAction,
  type ActionState,
} from "../../../actions";
import type { DuplicateReasonCode } from "@/core/contacts/duplicates";

export interface DuplicateContactSummary {
  id: string | null;
  name: string;
  email: string | null;
}

export interface DuplicateCandidateView {
  id: string;
  scoreLabel: string;
  detectedLabel: string;
  reasons: Array<{
    code: DuplicateReasonCode;
    label: string;
  }>;
  keepALabel: string;
  keepBLabel: string;
  contactA: DuplicateContactSummary;
  contactB: DuplicateContactSummary;
}

export interface MergeOperationView {
  id: string;
  mergedAt: string;
  undoneAt: string | null;
  undoable: boolean;
  securityCredentialInvalidated: boolean;
  mergedPairLabel: string;
}

export interface DuplicatePagination {
  label: string;
  previousHref: string | null;
  nextHref: string | null;
  previousLabel: string;
  nextLabel: string;
}

export interface DuplicateReviewLabels {
  queueTitle: string;
  queueCount: string;
  empty: string;
  scan: string;
  noEmail: string;
  dismiss: string;
  unavailable: string;
  historyTitle: string;
  historyIntro: string;
  historyEmpty: string;
  undo: string;
  undoAvailable: string;
  undone: string;
  undoUnavailable: string;
  undoSecurityBlocker: string;
  working: string;
}

function ContactSummary({
  contact,
  noEmail,
}: {
  contact: DuplicateContactSummary;
  noEmail: string;
}) {
  return (
    <div className="min-w-0">
      {contact.id ? (
        <a
          href={`/admin/contacts/${contact.id}`}
          className="font-medium underline decoration-rule underline-offset-2"
        >
          {contact.name}
        </a>
      ) : (
        <span className="font-medium">{contact.name}</span>
      )}
      <p className="mt-0.5 truncate text-xs text-ink-muted">
        {contact.email ?? noEmail}
      </p>
    </div>
  );
}

function ActionNotice({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
        {state.error}
      </Callout>
    );
  }
  if (state.saved && state.message) {
    return (
      <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
        {state.message}
      </Callout>
    );
  }
  return null;
}

/** Human decisions only: scanning can suggest, but it can never merge. */
export function DuplicateReview({
  candidates,
  operations,
  pagination,
  canManage,
  labels,
}: {
  candidates: DuplicateCandidateView[];
  operations: MergeOperationView[];
  pagination?: DuplicatePagination;
  canManage: boolean;
  labels: DuplicateReviewLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    duplicateReviewAction,
    {},
  );

  return (
    <div className="grid gap-6" aria-busy={pending}>
      {pending ? (
        <span role="status" className="sr-only">{labels.working}</span>
      ) : null}
      <ActionNotice state={state} />

      <Card>
        <CardHeader
          icon={<MagnifyingGlass size={17} weight="bold" />}
          title={labels.queueTitle}
          status={<Pill tone={candidates.length ? "warning" : "neutral"}>{labels.queueCount}</Pill>}
        />
        <CardBody>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-rule pb-4">
              <form action={action}>
                <input type="hidden" name="intent" value="scan" />
                <Button type="submit" variant="quiet" disabled={pending}>
                  <MagnifyingGlass size={15} weight="bold" />
                  {labels.scan}
                </Button>
              </form>
            </div>
          ) : null}

          {candidates.length === 0 ? (
            <p className="text-sm text-ink-muted">{labels.empty}</p>
          ) : (
            <ol className="grid list-none gap-4 p-0">
              {candidates.map((candidate) => {
                const available = Boolean(candidate.contactA.id && candidate.contactB.id);
                return (
                  <li
                    key={candidate.id}
                    className="rounded-lg border border-rule bg-surface-muted p-4"
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <Pill tone="warning">{candidate.scoreLabel}</Pill>
                      <span className="ms-auto font-mono text-xs text-ink-muted tabular-nums">
                        {candidate.detectedLabel}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                      <ContactSummary contact={candidate.contactA} noEmail={labels.noEmail} />
                      <ArrowsMerge
                        size={18}
                        weight="bold"
                        className="hidden text-ink-muted sm:block"
                        aria-hidden="true"
                      />
                      <ContactSummary contact={candidate.contactB} noEmail={labels.noEmail} />
                    </div>

                    <ul className="mt-4 flex list-none flex-wrap gap-2 p-0">
                      {candidate.reasons.map((reason) => (
                        <li key={reason.code}>
                          <Pill tone="accent">
                            {reason.label}
                          </Pill>
                        </li>
                      ))}
                    </ul>

                    {canManage ? (
                      available ? (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
                          {[
                            {
                              survivor: candidate.contactA,
                              duplicate: candidate.contactB,
                              label: candidate.keepALabel,
                            },
                            {
                              survivor: candidate.contactB,
                              duplicate: candidate.contactA,
                              label: candidate.keepBLabel,
                            },
                          ].map(({ survivor, duplicate, label }) => (
                            <form action={action} key={survivor.id}>
                              <input type="hidden" name="intent" value="merge" />
                              <input type="hidden" name="candidateId" value={candidate.id} />
                              <input type="hidden" name="survivingId" value={survivor.id ?? ""} />
                              <input type="hidden" name="duplicateId" value={duplicate.id ?? ""} />
                              <Button type="submit" disabled={pending}>
                                {label}
                              </Button>
                            </form>
                          ))}
                          <form action={action} className="sm:ms-auto">
                            <input type="hidden" name="intent" value="dismiss" />
                            <input type="hidden" name="candidateId" value={candidate.id} />
                            <Button type="submit" variant="quiet" disabled={pending}>
                              {labels.dismiss}
                            </Button>
                          </form>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-danger">{labels.unavailable}</p>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {pagination ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4 text-sm">
              <span className="text-ink-muted tabular-nums">{pagination.label}</span>
              <div className="ms-auto flex gap-2">
                {pagination.previousHref ? (
                  <a
                    href={pagination.previousHref}
                    className="rounded-md border border-rule px-3 py-1.5"
                  >
                    {pagination.previousLabel}
                  </a>
                ) : null}
                {pagination.nextHref ? (
                  <a
                    href={pagination.nextHref}
                    className="rounded-md border border-rule px-3 py-1.5"
                  >
                    {pagination.nextLabel}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<ClockCounterClockwise size={17} weight="bold" />}
          title={labels.historyTitle}
        />
        <CardBody>
          <p className="text-sm text-ink-muted">{labels.historyIntro}</p>
          {operations.length === 0 ? (
            <p className="text-sm text-ink-muted">{labels.historyEmpty}</p>
          ) : (
            <ol className="grid list-none gap-0 p-0">
              {operations.map((operation) => (
                <li
                  key={operation.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {operation.mergedPairLabel}
                    </p>
                    <p className="font-mono text-xs text-ink-muted tabular-nums">
                      {operation.mergedAt}
                    </p>
                    {!operation.undoable ? (
                      <p className="mt-1 text-xs text-warning">
                        {operation.securityCredentialInvalidated
                          ? labels.undoSecurityBlocker
                          : labels.undoUnavailable}
                      </p>
                    ) : null}
                  </div>
                  <div className="ms-auto">
                    {operation.undoneAt ? (
                      <Pill tone="neutral">{labels.undone}</Pill>
                    ) : operation.undoable && canManage ? (
                      <form action={action}>
                        <input type="hidden" name="intent" value="undo" />
                        <input type="hidden" name="operationId" value={operation.id} />
                        <Button type="submit" variant="quiet" disabled={pending}>
                          <ClockCounterClockwise size={15} weight="bold" />
                          {labels.undo}
                        </Button>
                      </form>
                    ) : operation.undoable ? (
                      <Pill tone="success">{labels.undoAvailable}</Pill>
                    ) : (
                      <Pill tone="warning">{labels.undoUnavailable}</Pill>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
