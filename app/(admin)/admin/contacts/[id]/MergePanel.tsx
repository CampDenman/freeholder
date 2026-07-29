// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import { ArrowsMerge, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Button, Callout, Card, CardBody, CardHeader } from "@/ui/primitives";
import { mergeContactAction, type ActionState } from "../../../actions";

export interface MergeCandidate {
  id: string;
  name: string;
  email: string | null;
}

/**
 * Search rather than a dropdown of everyone: a select listing every contact
 * stops being usable at a few hundred, which is a size a working business
 * reaches quickly. The search itself is a GET form, so the results are a URL.
 */
export function MergePanel({
  survivingId,
  query,
  candidates,
}: {
  survivingId: string;
  query: string;
  candidates: MergeCandidate[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    mergeContactAction,
    {},
  );

  return (
    <Card>
      <CardHeader
        icon={<ArrowsMerge size={17} weight="bold" />}
        title="Merge a duplicate"
      />
      <CardBody>
        {state.error ? (
          <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
            {state.error}
          </Callout>
        ) : null}
        <p className="text-sm text-ink-muted">
          Find the other record for this person. Its history moves here, and
          anything this contact is missing is filled in from it. The duplicate
          is then removed — this cannot be undone.
        </p>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-52 flex-1 gap-1.5">
            <label
              htmlFor="merge"
              className="font-mono text-xs font-medium text-ink-muted"
            >
              Search for the duplicate
            </label>
            <input
              id="merge"
              name="merge"
              type="search"
              defaultValue={query}
              placeholder="name or email"
              className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:border-accent"
            />
          </div>
          <Button type="submit" variant="quiet">
            Search
          </Button>
        </form>

        {query ? (
          candidates.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Nobody else matches “{query}”.
            </p>
          ) : (
            <ul className="grid list-none gap-0 p-0">
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule py-2.5 last:border-b-0"
                >
                  <span className="text-sm font-medium">{candidate.name}</span>
                  <span className="text-xs text-ink-muted">
                    {candidate.email ?? "no email"}
                  </span>
                  <form action={action} className="ms-auto">
                    <input
                      type="hidden"
                      name="survivingId"
                      value={survivingId}
                    />
                    <input
                      type="hidden"
                      name="duplicateId"
                      value={candidate.id}
                    />
                    <Button type="submit" variant="quiet" disabled={pending}>
                      Merge into this contact
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}
