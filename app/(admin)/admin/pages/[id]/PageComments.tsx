// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Comments, mentions and review requests on a working draft (C2.04).
import { ChatTeardropText } from "@phosphor-icons/react/dist/ssr";
import { Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import {
  addCommentAction,
  decideReviewAction,
  reopenThreadAction,
  requestReviewAction,
  resolveThreadAction,
} from "../../../cms-actions";

type CommentRow = {
  id: string;
  parentId: string | null;
  body: string;
  blockId: string | null;
  mentions: unknown;
  kind: "comment" | "review_request";
  reviewer: string | null;
  reviewState: "none" | "requested" | "approved" | "changes_requested";
  resolvedAt: Date | null;
  createdBy: string;
};

export function PageComments({
  pageId,
  comments,
  staff,
  labels,
}: {
  pageId: string;
  comments: CommentRow[];
  staff: { id: string; email: string }[];
  labels: {
    title: string;
    empty: string;
    placeholder: string;
    submit: string;
    reply: string;
    resolve: string;
    reopen: string;
    resolved: string;
    block: string;
    reviewRequest: string;
    reviewer: string;
    approve: string;
    requestChanges: string;
    mentionsHint: string;
  };
}) {
  const roots = comments.filter((row) => !row.parentId);
  const replies = new Map<string, CommentRow[]>();
  for (const row of comments) {
    if (!row.parentId) continue;
    const list = replies.get(row.parentId) ?? [];
    list.push(row);
    replies.set(row.parentId, list);
  }

  return (
    <Card>
      <CardHeader
        icon={<ChatTeardropText size={17} weight="bold" />}
        title={labels.title}
      />
      <CardBody>
        <form action={addCommentAction} className="grid gap-3">
          <input type="hidden" name="pageId" value={pageId} />
          <label className="grid gap-1 text-sm">
            <span className="sr-only">{labels.placeholder}</span>
            <textarea
              name="body"
              required
              rows={3}
              placeholder={labels.placeholder}
              className="rounded-md border border-rule bg-surface px-3 py-2 text-ink"
            />
          </label>
          <p className="text-xs text-ink-muted">{labels.mentionsHint}</p>
          <button
            type="submit"
            className="w-fit rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
          >
            {labels.submit}
          </button>
        </form>

        {staff.length === 0 ? null : (
        <form action={requestReviewAction} className="mt-4 grid gap-3 border-t border-rule pt-4">
          <input type="hidden" name="pageId" value={pageId} />
          <label className="grid gap-1 text-sm">
            <span className="text-ink-muted">{labels.reviewer}</span>
            <select
              name="reviewer"
              required
              className="rounded-md border border-rule bg-surface px-3 py-2 text-ink"
            >
              <option value=""> </option>
              {staff.map((person) => (
                <option key={person.id} value={`user:${person.id}`}>
                  {person.email}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="sr-only">{labels.reviewRequest}</span>
            <textarea
              name="body"
              required
              rows={2}
              placeholder={labels.reviewRequest}
              className="rounded-md border border-rule bg-surface px-3 py-2 text-ink"
            />
          </label>
          <button
            type="submit"
            className="w-fit rounded-md border border-rule px-3 py-1.5 text-sm font-medium text-ink"
          >
            {labels.reviewRequest}
          </button>
        </form>
        )}

        {roots.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">{labels.empty}</p>
        ) : (
          <ol className="mt-4 grid list-none gap-4 p-0">
            {roots.map((root) => (
              <li key={root.id} className="grid gap-2 border-t border-rule pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-muted">{root.createdBy}</span>
                  {root.blockId ? (
                    <span className="text-xs text-ink-muted">
                      {labels.block} {root.blockId}
                    </span>
                  ) : null}
                  {root.kind === "review_request" ? (
                    <Pill
                      tone={
                        root.reviewState === "approved"
                          ? "success"
                          : root.reviewState === "changes_requested"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {root.reviewState}
                    </Pill>
                  ) : null}
                  {root.resolvedAt ? (
                    <span className="text-xs text-ink-muted">{labels.resolved}</span>
                  ) : null}
                </div>
                <p className="text-sm text-ink">{root.body}</p>
                {(replies.get(root.id) ?? []).map((reply) => (
                  <p key={reply.id} className="ms-4 text-sm text-ink-muted">
                    <span className="font-mono text-xs">{reply.createdBy}</span> {reply.body}
                  </p>
                ))}
                <div className="flex flex-wrap gap-2">
                  {root.resolvedAt ? (
                    <form action={reopenThreadAction}>
                      <input type="hidden" name="id" value={root.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
                      >
                        {labels.reopen}
                      </button>
                    </form>
                  ) : (
                    <>
                      <form action={addCommentAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="pageId" value={pageId} />
                        <input type="hidden" name="parentId" value={root.id} />
                        <input
                          type="text"
                          name="body"
                          required
                          placeholder={labels.reply}
                          className="rounded-md border border-rule bg-surface px-2 py-1 text-xs text-ink"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
                        >
                          {labels.reply}
                        </button>
                      </form>
                      <form action={resolveThreadAction}>
                        <input type="hidden" name="id" value={root.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
                        >
                          {labels.resolve}
                        </button>
                      </form>
                    </>
                  )}
                  {root.kind === "review_request" && root.reviewState === "requested" ? (
                    <>
                      <form action={decideReviewAction}>
                        <input type="hidden" name="id" value={root.id} />
                        <input type="hidden" name="approved" value="true" />
                        <button
                          type="submit"
                          className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
                        >
                          {labels.approve}
                        </button>
                      </form>
                      <form action={decideReviewAction} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={root.id} />
                        <input type="hidden" name="approved" value="false" />
                        <input
                          type="text"
                          name="note"
                          placeholder={labels.requestChanges}
                          className="rounded-md border border-rule bg-surface px-2 py-1 text-xs text-ink"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-rule px-2.5 py-1 text-xs font-medium text-ink"
                        >
                          {labels.requestChanges}
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
