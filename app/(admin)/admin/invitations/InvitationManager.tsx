// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import {
  CheckCircle,
  Clock,
  EnvelopeSimple,
  PaperPlaneTilt,
  Prohibit,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
  type Tone,
} from "@/ui/primitives";
import {
  createInvitationAction,
  resendInvitationAction,
  revokeInvitationAction,
  type InvitationActionState,
} from "../../invitation-actions";

export interface InvitationRole {
  key: string;
  name: string;
  description: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  roleKey: string;
  roleName: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdBy: string;
  sendCount: number;
  lastAttemptedAt: string;
  lastSentAt: string | null;
  deliveryAdapter: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  history: Array<{ action: string; actor: string; at: string }>;
}

export interface InvitationLabels {
  createTitle: string;
  email: string;
  role: string;
  expiresIn: string;
  days: string;
  send: string;
  sending: string;
  sent: string;
  logged: string;
  pendingTitle: string;
  historyTitle: string;
  emptyPending: string;
  emptyHistory: string;
  statusPending: string;
  statusAccepted: string;
  statusRevoked: string;
  statusExpired: string;
  expires: string;
  created: string;
  delivery: string;
  deliveredAt: string;
  notDelivered: string;
  sentCount: string;
  resend: string;
  resending: string;
  revoke: string;
  revokeConfirm: string;
  revoked: string;
  audit: string;
  readOnly: string;
  noRoles: string;
}

const STATUS_TONE: Record<InvitationRow["status"], Tone> = {
  pending: "warning",
  accepted: "success",
  revoked: "danger",
  expired: "neutral",
};

function statusLabel(status: InvitationRow["status"], labels: InvitationLabels) {
  return {
    pending: labels.statusPending,
    accepted: labels.statusAccepted,
    revoked: labels.statusRevoked,
    expired: labels.statusExpired,
  }[status];
}

function Result({ state, labels }: { state: InvitationActionState; labels: InvitationLabels }) {
  if (state.error) {
    return (
      <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
        {state.error}
      </Callout>
    );
  }
  if (!state.saved) return null;
  return (
    <Callout tone="success" icon={<CheckCircle size={17} weight="fill" />}>
      {state.delivery === "logged"
        ? labels.logged
        : state.delivery === "sent"
          ? labels.sent
          : labels.revoked}
    </Callout>
  );
}

function CreateInvitation({
  roles,
  labels,
}: {
  roles: InvitationRole[];
  labels: InvitationLabels;
}) {
  const [state, action, pending] = useActionState<InvitationActionState, FormData>(
    createInvitationAction,
    {},
  );
  return (
    <Card>
      <CardHeader
        icon={<PaperPlaneTilt size={17} weight="fill" />}
        title={labels.createTitle}
      />
      <form action={action}>
        <CardBody>
          <Result state={state} labels={labels} />
          {roles.length === 0 ? <Callout tone="warning">{labels.noRoles}</Callout> : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_14rem_9rem]">
            <Field label={labels.email} htmlFor="invitation-email">
              <Input
                id="invitation-email"
                name="email"
                type="email"
                autoComplete="off"
                defaultValue={state.values?.email ?? ""}
                required
              />
            </Field>
            <Field label={labels.role} htmlFor="invitation-role">
              <Select
                id="invitation-role"
                name="roleKey"
                defaultValue={state.values?.roleKey ?? roles[0]?.key ?? ""}
                required
              >
                {roles.map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={labels.expiresIn} htmlFor="invitation-expiry">
              <Select
                id="invitation-expiry"
                name="expiresInDays"
                defaultValue={state.values?.expiresInDays ?? "7"}
              >
                {[1, 3, 7, 14, 30].map((days) => (
                  <option key={days} value={days}>
                    {days} {labels.days}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" disabled={pending || roles.length === 0}>
            {pending ? labels.sending : labels.send}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function InvitationActions({
  invitation,
  labels,
}: {
  invitation: InvitationRow;
  labels: InvitationLabels;
}) {
  const [resendState, resendAction, resending] = useActionState<
    InvitationActionState,
    FormData
  >(resendInvitationAction, {});
  const [revokeState, revokeAction, revoking] = useActionState<
    InvitationActionState,
    FormData
  >(revokeInvitationAction, {});
  return (
    <div className="grid gap-3">
      <Result
        state={resendState.error || resendState.saved ? resendState : revokeState}
        labels={labels}
      />
      <div className="flex flex-wrap gap-2">
        {invitation.status === "pending" || invitation.status === "expired" ? (
          <form action={resendAction}>
            <input type="hidden" name="id" value={invitation.id} />
            <Button type="submit" variant="quiet" disabled={resending}>
              <EnvelopeSimple size={15} />
              {resending ? labels.resending : labels.resend}
            </Button>
          </form>
        ) : null}
        {invitation.status === "pending" ? (
          <form
            action={revokeAction}
            onSubmit={(event) => {
              if (!window.confirm(labels.revokeConfirm)) event.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={invitation.id} />
            <Button type="submit" variant="danger" disabled={revoking}>
              <Prohibit size={15} />
              {labels.revoke}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function InvitationCard({
  invitation,
  labels,
  canManage,
}: {
  invitation: InvitationRow;
  labels: InvitationLabels;
  canManage: boolean;
}) {
  return (
    <Card>
      <CardHeader
        icon={<Clock size={17} weight="fill" />}
        title={invitation.email}
        status={
          <Pill tone={STATUS_TONE[invitation.status]}>
            {statusLabel(invitation.status, labels)}
          </Pill>
        }
      />
      <CardBody>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-mono text-xs text-ink-muted">{labels.role}</dt>
            <dd className="mt-1 text-ink">{invitation.roleName}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-ink-muted">{labels.expires}</dt>
            <dd className="mt-1 text-ink">{invitation.expiresAt}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-ink-muted">{labels.created}</dt>
            <dd className="mt-1 text-ink">{invitation.createdAt}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-ink-muted">{labels.delivery}</dt>
            <dd className="mt-1 text-ink">
              {invitation.lastSentAt
                ? `${labels.deliveredAt} ${invitation.lastSentAt}`
                : `${labels.notDelivered} (${invitation.deliveryAdapter ?? "—"})`}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-ink-muted">{labels.sentCount}</dt>
            <dd className="mt-1 text-ink">{invitation.sendCount}</dd>
          </div>
        </dl>
        {invitation.history.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-accent">
              {labels.audit}
            </summary>
            <ol className="mt-3 grid list-none gap-2 p-0 text-xs text-ink-muted">
              {invitation.history.map((event, index) => (
                <li key={`${event.action}-${event.at}-${index}`}>
                  <span className="font-medium text-ink">{event.action}</span>
                  {` · ${event.actor} · ${event.at}`}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        {canManage ? <InvitationActions invitation={invitation} labels={labels} /> : null}
      </CardBody>
    </Card>
  );
}

export function InvitationManager({
  invitations,
  roles,
  labels,
  canManage,
}: {
  invitations: InvitationRow[];
  roles: InvitationRole[];
  labels: InvitationLabels;
  canManage: boolean;
}) {
  const pending = invitations.filter((invitation) => invitation.status === "pending");
  const history = invitations.filter((invitation) => invitation.status !== "pending");
  return (
    <div className="grid gap-6">
      {!canManage ? <Callout>{labels.readOnly}</Callout> : null}
      {canManage ? <CreateInvitation roles={roles} labels={labels} /> : null}
      <section className="grid gap-4" aria-labelledby="pending-invitations">
        <h2 id="pending-invitations" className="text-lg font-semibold">
          {labels.pendingTitle}
        </h2>
        {pending.length === 0 ? (
          <Callout>{labels.emptyPending}</Callout>
        ) : (
          pending.map((invitation) => (
            <InvitationCard
              key={invitation.id}
              invitation={invitation}
              labels={labels}
              canManage={canManage}
            />
          ))
        )}
      </section>
      <section className="grid gap-4" aria-labelledby="invitation-history">
        <h2 id="invitation-history" className="text-lg font-semibold">
          {labels.historyTitle}
        </h2>
        {history.length === 0 ? (
          <Callout>{labels.emptyHistory}</Callout>
        ) : (
          history.map((invitation) => (
            <InvitationCard
              key={invitation.id}
              invitation={invitation}
              labels={labels}
              canManage={canManage}
            />
          ))
        )}
      </section>
    </div>
  );
}
