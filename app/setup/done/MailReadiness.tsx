// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Secret-free first-run discovery for the two mail routes (C1.14).
import { CheckCircle, EnvelopeSimple, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { MailConfigurationStatus } from "@/adapters/mail";
import { Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";

export interface MailReadinessLabels {
  title: string;
  intro: string;
  account: string;
  broadcast: string;
  configured: string;
  pending: string;
  disabled: string;
  accountSmtp: string;
  accountOauth: string;
  accountMissing: string;
  accountVariables: string;
  bulkDisabled: string;
  bulkReady: string;
  feedbackMissing: string;
  webhook: string;
  sesSecurity: string;
  next: string;
}

export function MailReadiness({
  configuration,
  appUrl,
  labels,
}: {
  configuration: MailConfigurationStatus;
  appUrl: string;
  labels: MailReadinessLabels;
}) {
  const oauth = configuration.oauth.filter((entry) => entry.configured);
  const accountConfigured = configuration.transactional.delivers || oauth.length > 0;
  const bulk = configuration.bulk;
  const endpoint = bulk.webhookPath
    ? `${appUrl.replace(/\/+$/, "")}${bulk.webhookPath}`
    : null;

  return (
    <Card>
      <CardHeader
        icon={<EnvelopeSimple size={17} weight="fill" />}
        title={labels.title}
      />
      <CardBody>
        <p className="text-sm text-ink-muted">{labels.intro}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="grid content-start gap-2 rounded-md border border-rule p-3" aria-label={labels.account}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">{labels.account}</h3>
              <Pill tone={accountConfigured ? "success" : "warning"}>
                {accountConfigured ? labels.configured : labels.pending}
              </Pill>
            </div>
            <p className="text-xs text-ink-muted">
              {configuration.transactional.delivers
                ? labels.accountSmtp
                : oauth.length > 0
                  ? `${labels.accountOauth} ${oauth
                      .map((entry) =>
                        entry.provider === "google" ? "Google" : "Microsoft",
                      )
                      .join(", ")}.`
                  : labels.accountMissing}
            </p>
            {!accountConfigured ? (
              <code className="break-words font-mono text-xs text-warning">
                {labels.accountVariables}
              </code>
            ) : null}
          </section>

          <section className="grid content-start gap-2 rounded-md border border-rule p-3" aria-label={labels.broadcast}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">{labels.broadcast}</h3>
              <Pill
                tone={
                  bulk.provider === "none"
                    ? "neutral"
                    : bulk.sendConfigured && bulk.feedbackConfigured
                      ? "success"
                      : "warning"
                }
              >
                {bulk.provider === "none"
                  ? labels.disabled
                  : bulk.sendConfigured && bulk.feedbackConfigured
                    ? labels.configured
                    : labels.pending}
              </Pill>
            </div>
            <p className="text-xs text-ink-muted">
              {bulk.provider === "none"
                ? labels.bulkDisabled
                : `${labels.bulkReady} ${bulk.provider}.`}
            </p>
            {bulk.missing.length > 0 ? (
              <Callout tone="warning" icon={<WarningCircle size={15} weight="fill" />}>
                <span className="grid gap-1">
                  <span>{labels.feedbackMissing}</span>
                  <code className="break-words font-mono text-xs">
                    {bulk.missing.join(", ")}
                  </code>
                </span>
              </Callout>
            ) : null}
            {endpoint ? (
              <p className="text-xs text-ink-muted">
                {labels.webhook} <code className="break-all font-mono text-ink">{endpoint}</code>
              </p>
            ) : null}
            {bulk.provider === "ses" ? (
              <p className="text-xs font-medium text-ink-muted">{labels.sesSecurity}</p>
            ) : null}
          </section>
        </div>
        <Callout
          tone={accountConfigured ? "success" : "warning"}
          icon={
            accountConfigured ? (
              <CheckCircle size={16} weight="fill" />
            ) : (
              <WarningCircle size={16} weight="fill" />
            )
          }
        >
          {labels.next}
        </Callout>
      </CardBody>
    </Card>
  );
}
