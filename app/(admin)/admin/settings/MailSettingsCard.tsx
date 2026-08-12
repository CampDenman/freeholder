// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Broadcast,
  CheckCircle,
  EnvelopeSimple,
  Pause,
  Play,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  type Tone,
} from "@/ui/primitives";
import {
  connectMailAction,
  mailSenderAction,
  registerMailSenderAction,
  releaseMailSuppressionAction,
  type ActionState,
} from "../../actions";

type Purpose = "transactional" | "bulk";
type Provider =
  | "gmail"
  | "outlook"
  | "smtp"
  | "console"
  | "resend"
  | "postmark"
  | "ses";

export interface MailConfigurationView {
  transactional: {
    provider: "smtp" | "console" | "gmail" | "outlook";
    delivers: boolean;
    missing: string[];
    fromAddress: string | null;
  };
  oauth: Array<{
    provider: "google" | "microsoft";
    configured: boolean;
    missing: string[];
  }>;
  bulk: {
    provider: "resend" | "postmark" | "ses" | "none";
    sendConfigured: boolean;
    feedbackConfigured: boolean;
    missing: string[];
    webhookPath: string | null;
    fromAddress: string | null;
  };
}

export interface MailSenderView {
  id: string;
  purpose: Purpose;
  provider: Provider;
  email: string;
  displayName: string | null;
  verificationStatus: "pending" | "verified" | "failed";
  status: "active" | "paused" | "needs_attention";
  isDefault: boolean;
  lastVerified: string | null;
  lastError: string | null;
  accountStatus: "active" | "needs_reconnect" | "revoked" | null;
  capabilityEnabled: boolean | null;
}

export interface MailDeliveryView {
  id: string;
  provider: string;
  recipient: string;
  subject: string;
  status: string;
  attempts: number;
  detail: string | null;
  when: string;
}

export interface MailSuppressionView {
  email: string;
  reason: string;
  provider: string;
  detail: string | null;
  when: string;
}

export interface MailLabels {
  title: string;
  intro: string;
  route: string;
  transactional: string;
  transactionalIntro: string;
  bulk: string;
  bulkIntro: string;
  provider: string;
  delivers: string;
  notDelivering: string;
  configured: string;
  incomplete: string;
  notConfigured: string;
  missing: string;
  connectGoogle: string;
  connectMicrosoft: string;
  register: string;
  senderEmail: string;
  displayName: string;
  providerIdentity: string;
  providerIdentityHint: string;
  webhook: string;
  feedbackReady: string;
  feedbackMissing: string;
  senders: string;
  noSenders: string;
  default: string;
  chooseDefault: string;
  verify: string;
  recheck: string;
  pause: string;
  reactivate: string;
  test: string;
  verified: string;
  pending: string;
  failed: string;
  active: string;
  paused: string;
  needsAttention: string;
  needsReconnect: string;
  revoked: string;
  permissionOff: string;
  lastChecked: string;
  recentDeliveries: string;
  noDeliveries: string;
  recipient: string;
  subject: string;
  status: string;
  attempts: string;
  when: string;
  suppressions: string;
  suppressionIntro: string;
  noSuppressions: string;
  reason: string;
  release: string;
  releaseHint: string;
  confirmation: string;
  readOnly: string;
  actionDone: string;
  pendingAction: string;
  deliveryStatuses: Record<string, string>;
  suppressionReasons: Record<string, string>;
}

export function MailSettingsCard({
  configuration,
  senders,
  deliveries,
  suppressions,
  labels,
  canManage,
  notice,
}: {
  configuration: MailConfigurationView;
  senders: MailSenderView[];
  deliveries: MailDeliveryView[];
  suppressions: MailSuppressionView[];
  labels: MailLabels;
  canManage: boolean;
  notice?: { tone: "success" | "warning" | "danger"; text: string };
}) {
  const transactional = senders.filter(
    (sender) => sender.purpose === "transactional",
  );
  const bulk = senders.filter((sender) => sender.purpose === "bulk");

  return (
    <section id="mail" aria-label={labels.title} className="scroll-mt-6">
      <Card>
        <CardHeader
          icon={<EnvelopeSimple size={18} weight="fill" />}
          title={labels.title}
          status={
            <Pill
              tone={
                transactional.some((sender) => senderReady(sender))
                  ? "success"
                  : "warning"
              }
            >
              {transactional.some((sender) => senderReady(sender))
                ? labels.delivers
                : labels.notDelivering}
            </Pill>
          }
        />
        <CardBody>
          <p className="max-w-3xl text-sm text-ink-muted">
            {labels.intro}
          </p>
          {notice ? (
            <Callout
              tone={notice.tone}
              icon={
                notice.tone === "success" ? (
                  <CheckCircle size={16} weight="fill" />
                ) : (
                  <WarningCircle size={16} weight="fill" />
                )
              }
            >
              {notice.text}
            </Callout>
          ) : null}
          {!canManage ? (
            <Callout tone="neutral">{labels.readOnly}</Callout>
          ) : null}

          <div className="grid gap-2">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {labels.route}
            </h3>
            <div className="grid overflow-hidden rounded-lg border border-rule lg:grid-cols-2">
              <RouteLane
              purpose="transactional"
              icon={<EnvelopeSimple size={20} weight="fill" />}
              title={labels.transactional}
              intro={labels.transactionalIntro}
              provider={configuration.transactional.provider}
              ready={
                configuration.transactional.delivers ||
                transactional.some((sender) => senderReady(sender))
              }
              missing={configuration.transactional.missing}
              configuration={configuration}
              labels={labels}
              canManage={canManage}
              />
              <RouteLane
              purpose="bulk"
              icon={<Broadcast size={20} weight="fill" />}
              title={labels.bulk}
              intro={labels.bulkIntro}
              provider={configuration.bulk.provider}
              ready={
                configuration.bulk.sendConfigured &&
                configuration.bulk.feedbackConfigured
              }
              missing={configuration.bulk.missing}
              configuration={configuration}
              labels={labels}
              canManage={canManage}
              />
            </div>
          </div>

          <div className="grid gap-3">
            <h3 className="text-sm font-semibold text-ink">{labels.senders}</h3>
            {senders.length === 0 ? (
              <p className="text-sm text-ink-muted">{labels.noSenders}</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <SenderGroup
                  title={labels.transactional}
                  senders={transactional}
                  labels={labels}
                  canManage={canManage}
                />
                <SenderGroup
                  title={labels.bulk}
                  senders={bulk}
                  labels={labels}
                  canManage={canManage}
                />
              </div>
            )}
          </div>

          <DeliveryLedger deliveries={deliveries} labels={labels} />
          <SuppressionList
            suppressions={suppressions}
            labels={labels}
            canManage={canManage}
          />
        </CardBody>
      </Card>
    </section>
  );
}

function RouteLane({
  purpose,
  icon,
  title,
  intro,
  provider,
  ready,
  missing,
  configuration,
  labels,
  canManage,
}: {
  purpose: Purpose;
  icon: React.ReactNode;
  title: string;
  intro: string;
  provider: string;
  ready: boolean;
  missing: string[];
  configuration: MailConfigurationView;
  labels: MailLabels;
  canManage: boolean;
}) {
  const configuredFrom =
    purpose === "transactional"
      ? configuration.transactional.fromAddress
      : configuration.bulk.fromAddress;
  const environmentProvider =
    purpose === "transactional"
      ? configuration.transactional.provider
      : configuration.bulk.provider;
  const registerable =
    (purpose === "transactional" && environmentProvider === "smtp") ||
    (purpose === "bulk" && environmentProvider !== "none");

  return (
    <div className="grid content-start gap-4 bg-surface px-4 py-5 first:border-b first:border-rule lg:first:border-e lg:first:border-b-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-accent">{icon}</span>
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{intro}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="font-mono text-ink-muted">{labels.provider}</dt>
        <dd className="font-semibold text-ink">{providerLabel(provider)}</dd>
        <dt className="font-mono text-ink-muted">{labels.status}</dt>
        <dd>
          <Pill tone={ready ? "success" : "warning"}>
            {ready ? labels.configured : labels.incomplete}
          </Pill>
        </dd>
        {purpose === "bulk" && configuration.bulk.webhookPath ? (
          <>
            <dt className="font-mono text-ink-muted">{labels.webhook}</dt>
            <dd className="min-w-0">
              <code className="break-all text-ink">
                {configuration.bulk.webhookPath}
              </code>
              <span className="ms-2 text-ink-muted">
                {configuration.bulk.feedbackConfigured
                  ? labels.feedbackReady
                  : labels.feedbackMissing}
              </span>
            </dd>
          </>
        ) : null}
      </dl>
      {missing.length > 0 ? (
        <Callout tone="warning" icon={<WarningCircle size={16} weight="fill" />}>
          <span className="grid gap-1">
            <span>{labels.missing}</span>
            <code className="break-words font-mono text-xs">
              {missing.join(", ")}
            </code>
          </span>
        </Callout>
      ) : null}

      {purpose === "transactional" && canManage ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {configuration.oauth.map((oauth) => (
            <ConnectForm
              key={oauth.provider}
              provider={oauth.provider}
              disabled={!oauth.configured}
              label={
                oauth.provider === "google"
                  ? labels.connectGoogle
                  : labels.connectMicrosoft
              }
              pendingLabel={labels.pendingAction}
            />
          ))}
        </div>
      ) : null}

      {canManage && registerable && configuredFrom ? (
        <RegisterSenderForm
          purpose={purpose}
          provider={environmentProvider as "smtp" | "resend" | "postmark" | "ses"}
          email={configuredFrom}
          labels={labels}
        />
      ) : null}
      {canManage && registerable && !configuredFrom && missing.length === 0 ? (
        <Callout tone="warning">{labels.notConfigured}</Callout>
      ) : null}
    </div>
  );
}

function ConnectForm({
  provider,
  disabled,
  label,
  pendingLabel,
}: {
  provider: "google" | "microsoft";
  disabled: boolean;
  label: string;
  pendingLabel: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    connectMailAction,
    {},
  );
  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="provider" value={provider} />
      <Button type="submit" variant="quiet" disabled={disabled || pending}>
        <ArrowSquareOut size={15} />
        {pending ? pendingLabel : label}
      </Button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function RegisterSenderForm({
  purpose,
  provider,
  email,
  labels,
}: {
  purpose: Purpose;
  provider: "smtp" | "resend" | "postmark" | "ses";
  email: string;
  labels: MailLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    registerMailSenderAction,
    {},
  );
  const formId = `register-mail-${purpose}`;
  return (
    <form id={formId} action={action} className="grid gap-3 border-t border-rule pt-4">
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="provider" value={provider} />
      {state.error ? (
        <Callout tone="danger" icon={<WarningCircle size={16} weight="fill" />}>
          {state.error}
        </Callout>
      ) : null}
      {state.saved ? (
        <Callout tone="success" icon={<CheckCircle size={16} weight="fill" />}>
          {labels.actionDone}
        </Callout>
      ) : null}
      <Field label={labels.senderEmail} htmlFor={`${formId}-email`}>
        <Input
          id={`${formId}-email`}
          name="email"
          type="email"
          value={email}
          readOnly
        />
      </Field>
      <Field label={labels.displayName} htmlFor={`${formId}-name`}>
        <Input id={`${formId}-name`} name="displayName" maxLength={200} />
      </Field>
      {purpose === "bulk" ? (
        <Field
          label={labels.providerIdentity}
          htmlFor={`${formId}-identity`}
          hint={labels.providerIdentityHint}
        >
          <Input id={`${formId}-identity`} name="providerIdentity" maxLength={300} />
        </Field>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? labels.pendingAction : labels.register}
        </Button>
      </div>
    </form>
  );
}

function SenderGroup({
  title,
  senders,
  labels,
  canManage,
}: {
  title: string;
  senders: MailSenderView[];
  labels: MailLabels;
  canManage: boolean;
}) {
  return (
    <section className="rounded-md border border-rule bg-surface-muted/40 p-3" aria-label={title}>
      <h4 className="font-mono text-xs font-semibold text-ink-muted">{title}</h4>
      {senders.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{labels.noSenders}</p>
      ) : (
        <ul className="mt-2 grid list-none gap-3 p-0">
          {senders.map((sender) => (
            <li key={sender.id} className="grid gap-2 border-b border-rule pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">
                  {sender.displayName || sender.email}
                </span>
                <Pill tone={verificationTone(sender.verificationStatus)}>
                  {verificationLabel(sender.verificationStatus, labels)}
                </Pill>
                <Pill tone={senderStatusTone(sender)}>
                  {senderStatusLabel(sender, labels)}
                </Pill>
                {sender.isDefault ? <Pill tone="accent">{labels.default}</Pill> : null}
              </div>
              {sender.displayName ? (
                <span className="font-mono text-xs text-ink-muted">{sender.email}</span>
              ) : null}
              <span className="text-xs text-ink-muted">
                {providerLabel(sender.provider)}
                {sender.lastVerified ? ` · ${labels.lastChecked} ${sender.lastVerified}` : ""}
              </span>
              {sender.lastError ? (
                <Callout tone="warning" icon={<WarningCircle size={15} weight="fill" />}>
                  {sender.lastError}
                </Callout>
              ) : null}
              {canManage ? <SenderActions sender={sender} labels={labels} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SenderActions({
  sender,
  labels,
}: {
  sender: MailSenderView;
  labels: MailLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    mailSenderAction,
    {},
  );
  const canDefault = senderReady(sender) && !sender.isDefault;
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="id" value={sender.id} />
      <div className="flex flex-wrap gap-2">
        {sender.purpose === "bulk" ? (
          <Button type="submit" name="intent" value="verify" variant="quiet" disabled={pending}>
            <ArrowsClockwise size={14} />
            {sender.lastVerified ? labels.recheck : labels.verify}
          </Button>
        ) : null}
        {canDefault ? (
          <Button type="submit" name="intent" value="default" variant="quiet" disabled={pending}>
            {labels.chooseDefault}
          </Button>
        ) : null}
        <Button type="submit" name="intent" value="test" variant="quiet" disabled={pending || !senderReady(sender)}>
          {labels.test}
        </Button>
        <Button
          type="submit"
          name="intent"
          value={sender.status === "paused" ? "activate" : "pause"}
          variant="quiet"
          disabled={pending}
        >
          {sender.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
          {sender.status === "paused" ? labels.reactivate : labels.pause}
        </Button>
      </div>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      {state.saved ? <span className="text-xs text-success">{labels.actionDone}</span> : null}
    </form>
  );
}

function DeliveryLedger({
  deliveries,
  labels,
}: {
  deliveries: MailDeliveryView[];
  labels: MailLabels;
}) {
  return (
    <section className="grid gap-3" aria-labelledby="mail-delivery-heading">
      <h3 id="mail-delivery-heading" className="text-sm font-semibold text-ink">
        {labels.recentDeliveries}
      </h3>
      {deliveries.length === 0 ? (
        <p className="text-sm text-ink-muted">{labels.noDeliveries}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-rule">
          <table className="w-full min-w-[46rem] text-start text-xs">
            <thead className="border-b border-rule bg-surface-muted font-mono text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{labels.recipient}</th>
                <th scope="col" className="px-3 py-2 font-medium">{labels.subject}</th>
                <th scope="col" className="px-3 py-2 font-medium">{labels.provider}</th>
                <th scope="col" className="px-3 py-2 font-medium">{labels.status}</th>
                <th scope="col" className="px-3 py-2 font-medium">{labels.attempts}</th>
                <th scope="col" className="px-3 py-2 font-medium">{labels.when}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="border-b border-rule last:border-0">
                  <td className="px-3 py-2 font-mono text-ink">{delivery.recipient}</td>
                  <td className="max-w-64 px-3 py-2 text-ink">
                    <span className="block truncate" title={delivery.subject}>{delivery.subject}</span>
                    {delivery.detail ? <span className="block text-ink-muted">{delivery.detail}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{providerLabel(delivery.provider)}</td>
                  <td className="px-3 py-2">
                    <Pill tone={deliveryTone(delivery.status)}>
                      {labels.deliveryStatuses[delivery.status] ?? delivery.status}
                    </Pill>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{delivery.attempts}</td>
                  <td className="px-3 py-2 text-ink-muted">{delivery.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SuppressionList({
  suppressions,
  labels,
  canManage,
}: {
  suppressions: MailSuppressionView[];
  labels: MailLabels;
  canManage: boolean;
}) {
  return (
    <section className="grid gap-3" aria-labelledby="mail-suppression-heading">
      <div>
        <h3 id="mail-suppression-heading" className="text-sm font-semibold text-ink">
          {labels.suppressions}
        </h3>
        <p className="mt-1 text-sm text-ink-muted">{labels.suppressionIntro}</p>
      </div>
      {suppressions.length === 0 ? (
        <p className="text-sm text-ink-muted">{labels.noSuppressions}</p>
      ) : (
        <ul className="grid list-none gap-3 p-0">
          {suppressions.map((suppression) => (
            <li key={suppression.email} className="grid gap-2 rounded-md border border-rule p-3 md:grid-cols-[1fr_auto] md:items-start">
              <div className="min-w-0">
                <span className="break-all font-mono text-sm text-ink">{suppression.email}</span>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <Pill tone="danger">
                    {labels.suppressionReasons[suppression.reason] ?? suppression.reason}
                  </Pill>
                  <span>{providerLabel(suppression.provider)}</span>
                  <span>{suppression.when}</span>
                </div>
                {suppression.detail ? <p className="mt-2 text-xs text-ink-muted">{suppression.detail}</p> : null}
              </div>
              {canManage ? (
                <ReleaseSuppressionForm suppression={suppression} labels={labels} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReleaseSuppressionForm({
  suppression,
  labels,
}: {
  suppression: MailSuppressionView;
  labels: MailLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    releaseMailSuppressionAction,
    {},
  );
  const id = `release-${suppression.email.replace(/[^a-z0-9]+/gi, "-")}`;
  return (
    <form action={action} className="grid w-full gap-2 md:w-72">
      <input type="hidden" name="email" value={suppression.email} />
      <Field label={labels.confirmation} htmlFor={id} hint={labels.releaseHint}>
        <Input
          id={id}
          name="confirmation"
          type="email"
          autoComplete="off"
          required
          placeholder={suppression.email}
        />
      </Field>
      <div>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? labels.pendingAction : labels.release}
        </Button>
      </div>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function senderReady(sender: MailSenderView): boolean {
  return (
    sender.status === "active" &&
    sender.verificationStatus === "verified" &&
    sender.accountStatus !== "needs_reconnect" &&
    sender.accountStatus !== "revoked" &&
    sender.capabilityEnabled !== false
  );
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    gmail: "Gmail",
    google: "Google",
    outlook: "Microsoft Outlook",
    microsoft: "Microsoft",
    smtp: "SMTP",
    console: "Console",
    resend: "Resend",
    postmark: "Postmark",
    ses: "Amazon SES",
    none: "—",
    manual: "Freeholder",
  };
  return labels[provider] ?? provider;
}

function verificationTone(status: MailSenderView["verificationStatus"]): Tone {
  return status === "verified" ? "success" : status === "failed" ? "danger" : "warning";
}

function verificationLabel(
  status: MailSenderView["verificationStatus"],
  labels: MailLabels,
): string {
  return status === "verified"
    ? labels.verified
    : status === "failed"
      ? labels.failed
      : labels.pending;
}

function senderStatusTone(sender: MailSenderView): Tone {
  if (sender.accountStatus === "revoked" || sender.status === "needs_attention") return "danger";
  if (sender.accountStatus === "needs_reconnect" || sender.status === "paused") return "warning";
  return "success";
}

function senderStatusLabel(sender: MailSenderView, labels: MailLabels): string {
  if (sender.accountStatus === "revoked") return labels.revoked;
  if (sender.accountStatus === "needs_reconnect") return labels.needsReconnect;
  if (sender.capabilityEnabled === false) return labels.permissionOff;
  if (sender.status === "needs_attention") return labels.needsAttention;
  if (sender.status === "paused") return labels.paused;
  return labels.active;
}

function deliveryTone(status: string): Tone {
  if (status === "delivered") return "success";
  if (["bounced", "complained", "failed", "suppressed"].includes(status)) return "danger";
  if (status === "queued") return "neutral";
  return "warning";
}
