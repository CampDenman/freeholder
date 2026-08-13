// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useActionState } from "react";
import { ShareNetwork, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  createRelationshipAction,
  deleteRelationshipAction,
  updateRelationshipAction,
  type ActionState,
} from "../../../actions";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from "@/ui/primitives";

const KINDS = ["household", "employer", "referred_by", "partner", "guardian"] as const;

interface RelationshipRow {
  id: string;
  kind: (typeof KINDS)[number];
  direction: "peer" | "outgoing" | "incoming";
  since: string | null;
  notes: string | null;
  otherContact: { id: string; name: string; email: string | null };
}

function Editor({
  contactId,
  relationship,
  labels,
}: {
  contactId: string;
  relationship: RelationshipRow;
  labels: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateRelationshipAction,
    {},
  );
  const [deleteState, deleteAction, deleting] = useActionState<ActionState, FormData>(
    deleteRelationshipAction,
    {},
  );
  return (
    <li className="grid gap-3 border-b border-rule py-4 last:border-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <a
          href={`/admin/contacts/${relationship.otherContact.id}`}
          className="font-medium underline decoration-rule underline-offset-2"
        >
          {relationship.otherContact.name}
        </a>
        <span className="text-xs text-ink-muted">
          {labels[`display.${relationship.kind}.${relationship.direction}`]}
        </span>
        {relationship.otherContact.email ? (
          <span className="text-xs text-ink-muted">{relationship.otherContact.email}</span>
        ) : null}
      </div>
      {state.error || deleteState.error ? (
        <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
          {state.error ?? deleteState.error}
        </Callout>
      ) : null}
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_11rem_2fr_auto] sm:items-end">
        <input type="hidden" name="id" value={relationship.id} />
        <input type="hidden" name="contactId" value={contactId} />
        <input
          type="hidden"
          name="otherContactId"
          value={relationship.otherContact.id}
        />
        <Field label={labels.kind!} htmlFor={`kind-${relationship.id}`}>
          <Select
            id={`kind-${relationship.id}`}
            name="kind"
            defaultValue={relationship.kind}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {labels[`create.${kind}`]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.since!} htmlFor={`since-${relationship.id}`}>
          <Input
            id={`since-${relationship.id}`}
            name="since"
            type="date"
            defaultValue={relationship.since ?? ""}
          />
        </Field>
        <Field label={labels.notes!} htmlFor={`notes-${relationship.id}`}>
          <Input
            id={`notes-${relationship.id}`}
            name="notes"
            defaultValue={relationship.notes ?? ""}
          />
        </Field>
        <Button type="submit" variant="quiet" disabled={pending}>
          {labels.save}
        </Button>
      </form>
      <form action={deleteAction}>
        <input type="hidden" name="id" value={relationship.id} />
        <input type="hidden" name="contactId" value={contactId} />
        <Button type="submit" variant="danger" disabled={deleting} className="px-3 py-1.5 text-xs">
          {labels.remove}
        </Button>
      </form>
    </li>
  );
}

export function RelationshipPanel({
  contactId,
  query,
  candidates,
  relationships,
  labels,
  canManage,
}: {
  contactId: string;
  query: string;
  candidates: Array<{ id: string; name: string; email: string | null }>;
  relationships: RelationshipRow[];
  labels: Record<string, string>;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createRelationshipAction,
    {},
  );
  return (
    <Card>
      <CardHeader icon={<ShareNetwork size={17} weight="bold" />} title={labels.title!} />
      <CardBody>
        <p className="text-sm text-ink-muted">{labels.intro}</p>
        {relationships.length === 0 ? (
          <p className="text-sm text-ink-muted">{labels.empty}</p>
        ) : canManage ? (
          <ul className="grid list-none gap-0 p-0">
            {relationships.map((relationship) => (
              <Editor
                key={relationship.id}
                contactId={contactId}
                relationship={relationship}
                labels={labels}
              />
            ))}
          </ul>
        ) : (
          <ul className="grid list-none gap-0 p-0">
            {relationships.map((relationship) => (
              <li key={relationship.id} className="border-b border-rule py-2.5 last:border-0">
                <a href={`/admin/contacts/${relationship.otherContact.id}`} className="font-medium underline">
                  {relationship.otherContact.name}
                </a>
                <span className="ms-2 text-xs text-ink-muted">
                  {labels[`display.${relationship.kind}.${relationship.direction}`]}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <section className="grid gap-4 border-t border-rule pt-5">
            <form method="get" className="flex flex-wrap items-end gap-2">
              <div className="grid min-w-52 flex-1 gap-1.5">
                <label htmlFor="related" className="font-mono text-xs text-ink-muted">
                  {labels.search}
                </label>
                <Input id="related" name="related" type="search" defaultValue={query} />
              </div>
              <Button type="submit" variant="quiet">{labels.find}</Button>
            </form>
            {state.error ? (
              <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
                {state.error}
              </Callout>
            ) : null}
            {query && candidates.length === 0 ? (
              <p className="text-sm text-ink-muted">{labels.noResults}</p>
            ) : candidates.length > 0 ? (
              <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
                <input type="hidden" name="contactId" value={contactId} />
                <Field label={labels.person!} htmlFor="otherContactId">
                  <Select id="otherContactId" name="otherContactId" required>
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}{candidate.email ? ` — ${candidate.email}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={labels.kind!} htmlFor="relationship-kind">
                  <Select id="relationship-kind" name="kind" defaultValue="household">
                    {KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {labels[`create.${kind}`]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={labels.since!} htmlFor="relationship-since">
                  <Input id="relationship-since" name="since" type="date" />
                </Field>
                <Field label={labels.notes!} htmlFor="relationship-notes">
                  <Input id="relationship-notes" name="notes" />
                </Field>
                <Button type="submit" disabled={pending}>{labels.add}</Button>
              </form>
            ) : null}
          </section>
        ) : null}
      </CardBody>
    </Card>
  );
}
