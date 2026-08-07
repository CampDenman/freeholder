// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useActionState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  ShareNetwork,
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
} from "@/ui/primitives";
import {
  createWebhookAction,
  webhookAction,
  type ActionState,
} from "../../actions";

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: "active" | "paused";
  pausedReason: string | null;
  lastDelivery: string | null;
}

export interface DeliveryRow {
  id: string;
  event: string;
  status: string;
  attempts: number;
  detail: string;
  when: string;
}

export interface WebhooksLabels {
  cardTitle: string;
  intro: string;
  name: string;
  nameHint: string;
  url: string;
  urlHint: string;
  events: string;
  eventsHint: string;
  create: string;
  pending: string;
  existing: string;
  empty: string;
  never: string;
  lastDelivery: string;
  paused: string;
  active: string;
  test: string;
  pause: string;
  resume: string;
  reveal: string;
  remove: string;
  removeConfirm: string;
  secretShown: string;
  secretHint: string;
  recent: string;
  noDeliveries: string;
}

const FORM_ID = "new-webhook";

/**
 * Outbound webhooks (§11's bus, pointed outward).
 *
 * The delivery log is on the same screen as the subscriptions on purpose. The
 * only question an owner ever has here is "is it working", and answering it
 * from a list of endpoints alone is impossible — what they need is the last
 * few attempts and what came back.
 */
export function WebhooksCard({
  hooks,
  deliveries,
  labels,
}: {
  hooks: WebhookRow[];
  deliveries: DeliveryRow[];
  labels: WebhooksLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createWebhookAction,
    {},
  );

  return (
    <Card>
      <CardHeader
        icon={<ShareNetwork size={17} weight="fill" />}
        title={labels.cardTitle}
      />
      <CardBody>
        <p className="max-w-prose text-sm text-ink-muted">{labels.intro}</p>

        {hooks.length === 0 ? (
          <p className="text-sm text-ink-muted">{labels.empty}</p>
        ) : (
          <ul className="grid list-none gap-3 p-0">
            {hooks.map((hook) => (
              <li key={hook.id} className="grid gap-1.5 border-b border-rule pb-3 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-semibold text-ink">{hook.name}</span>
                  <Pill tone={hook.status === "active" ? "success" : "warning"}>
                    {hook.status === "active" ? labels.active : labels.paused}
                  </Pill>
                  {hook.events.map((event) => (
                    <Pill key={event} tone="accent">
                      {event}
                    </Pill>
                  ))}
                </div>
                <span className="font-mono text-xs break-all text-ink-muted">
                  {hook.url}
                </span>
                <span className="text-xs text-ink-muted">
                  {hook.lastDelivery
                    ? `${labels.lastDelivery} ${hook.lastDelivery}`
                    : labels.never}
                </span>
                {hook.pausedReason ? (
                  <Callout tone="warning" icon={<WarningCircle size={15} weight="fill" />}>
                    {hook.pausedReason}
                  </Callout>
                ) : null}
                <RowActions hook={hook} labels={labels} />
              </li>
            ))}
          </ul>
        )}

        {deliveries.length > 0 ? (
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold text-ink">{labels.recent}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id} className="border-b border-rule last:border-0">
                      <td className="py-1.5 pe-3 font-mono text-ink-muted">
                        {delivery.event}
                      </td>
                      <td className="py-1.5 pe-3">
                        <Pill
                          tone={
                            delivery.status === "succeeded"
                              ? "success"
                              : delivery.status === "failed"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {delivery.status}
                        </Pill>
                      </td>
                      <td className="py-1.5 pe-3 text-ink-muted">{delivery.detail}</td>
                      <td className="py-1.5 text-ink-muted">{delivery.when}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : hooks.length > 0 ? (
          <p className="text-sm text-ink-muted">{labels.noDeliveries}</p>
        ) : null}

        <form id={FORM_ID} action={action} className="grid gap-5 border-t border-rule pt-5">
          {state.error ? (
            <Callout tone="danger" icon={<WarningCircle size={17} weight="fill" />}>
              {state.error}
            </Callout>
          ) : null}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={labels.name} htmlFor="hook-name" hint={labels.nameHint}>
              <Input id="hook-name" name="name" required maxLength={80} />
            </Field>
            <Field label={labels.events} htmlFor="hook-events" hint={labels.eventsHint}>
              <Input id="hook-events" name="events" required defaultValue="*" />
            </Field>
          </div>
          <Field label={labels.url} htmlFor="hook-url" hint={labels.urlHint}>
            <Input id="hook-url" name="url" type="url" required />
          </Field>
        </form>
      </CardBody>
      <CardFooter>
        <Button type="submit" form={FORM_ID} disabled={pending}>
          {pending ? labels.pending : labels.create}
        </Button>
      </CardFooter>
    </Card>
  );
}

function RowActions({
  hook,
  labels,
}: {
  hook: WebhookRow;
  labels: WebhooksLabels;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    webhookAction,
    {},
  );
  const paused = hook.status === "paused";

  return (
    <form
      action={action}
      onSubmit={(event) => {
        // Which button was pressed: four submits share this form, and only
        // deletion needs confirming.
        const intent = event.nativeEvent.submitter?.getAttribute("value");
        if (intent === "remove" && !window.confirm(labels.removeConfirm)) {
          event.preventDefault();
        }
      }}
      className="grid gap-2"
    >
      <input type="hidden" name="id" value={hook.id} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="intent" value="test" variant="quiet" disabled={pending}>
          <ArrowsClockwise size={14} />
          {labels.test}
        </Button>
        <Button
          type="submit"
          name="intent"
          value={paused ? "resume" : "pause"}
          variant="quiet"
          disabled={pending}
        >
          {paused ? labels.resume : labels.pause}
        </Button>
        <Button type="submit" name="intent" value="reveal" variant="quiet" disabled={pending}>
          {labels.reveal}
        </Button>
        <Button type="submit" name="intent" value="remove" variant="danger" disabled={pending}>
          {labels.remove}
        </Button>
      </div>
      {state.error ? (
        <span className="text-xs text-danger">{state.error}</span>
      ) : null}
      {state.saved && state.message ? (
        <Callout tone="success" icon={<CheckCircle size={15} weight="fill" />}>
          <span className="grid gap-1">
            <span className="font-semibold">{labels.secretShown}</span>
            <code className="block overflow-x-auto rounded bg-surface-muted px-2 py-1 font-mono text-xs text-ink">
              {state.message}
            </code>
            <span className="text-xs">{labels.secretHint}</span>
          </span>
        </Callout>
      ) : null}
    </form>
  );
}
