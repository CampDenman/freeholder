// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The front-site assistant's one screen (C9.21, MASTER.md §31).
//
// Ordered the way the decision is actually made, which is not the order the
// columns happen to be in. First: is it on, and does it work — because an
// owner who arrives here has either just heard of this or is asking why it
// went quiet, and both questions are answered at the top. Then the money and
// the rate limits, which are what makes switching it on survivable. Then what
// it is allowed to *do*, which is the part worth reading slowly. Then the last
// fifty attempts, including the refused ones, because "it stopped answering"
// has half a dozen causes and guessing between them is the whole problem.
//
// The key is not on this screen and cannot be. §17 keeps secrets in the
// environment, so what an owner types here is the *name* of a variable, and
// what the screen tells them back is whether this deployment has it. That is
// less convenient than a paste box and considerably better than a model key
// sitting in a database backup.
import type { Metadata } from "next";
import { Robot, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { currentBusiness } from "@/core/settings/read";
import { formatMoney } from "@/core/i18n";
import {
  ASSISTANT_PROVIDERS,
  ASSISTANT_SPEND_PERIODS,
  KNOWLEDGE_KINDS,
} from "@/modules/assistant/contract";
import { knowledgeList, scopes, settings, turns } from "@/modules/assistant/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  saveAssistantAction,
  saveKnowledgeAction,
  deleteKnowledgeAction,
  reindexAssistantAction,
  setAssistantScopeAction,
} from "../../assistant-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** A refusal is not a failure of the platform, so it is not shown as one. */
const OUTCOME_TONES = {
  answered: "success",
  refused_scope: "warning",
  refused_spend: "warning",
  refused_rate: "warning",
  refused_conversation_cap: "warning",
  unconfigured: "neutral",
  failed: "danger",
} as const;

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("assistant", "manage");
  const [t, business, current, grants, attempts, facts, query] = await Promise.all([
    getT(),
    currentBusiness(),
    domainOrNull(settings.call({}, actor)),
    domainOrNull(scopes.call({}, actor)),
    domainOrNull(turns.call({ limit: 50 }, actor)),
    domainOrNull(knowledgeList.call({}, actor)),
    searchParams,
  ]);

  const locale = business?.defaultLocale ?? "en";
  const currency = business?.baseCurrency ?? "USD";
  const money = (cents: number) => formatMoney(cents, currency, locale);
  const when = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: business?.timezone ?? "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  const spentShare =
    current && current.spendCapCents > 0
      ? Math.min(100, Math.round((current.spentCents * 100) / current.spendCapCents))
      : 0;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Robot size={22} weight="duotone" className="text-accent" />
          {t("assistant.title")}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("assistant.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("assistant.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}

      {current === null ? (
        <Callout tone="danger" icon={<WarningCircle size={18} weight="duotone" />}>
          {t("assistant.unavailable")}
        </Callout>
      ) : (
        <>
          {current.enabled && !current.ready ? (
            <Callout tone="warning" icon={<WarningCircle size={18} weight="duotone" />}>
              {t("assistant.notReady")}
            </Callout>
          ) : null}
          {current.lastError ? (
            <Callout tone="danger" icon={<WarningCircle size={18} weight="duotone" />}>
              {current.lastError}
            </Callout>
          ) : null}

          <form action={saveAssistantAction} className="grid gap-6">
            <Card>
              <CardHeader
                title={t("assistant.setup")}
                status={
                  <Pill tone={current.enabled ? "success" : "neutral"}>
                    {current.enabled ? t("assistant.state.on") : t("assistant.state.off")}
                  </Pill>
                }
              />
              <CardBody>
                <p className="max-w-prose text-sm text-ink-muted">
                  {t("assistant.setupHint")}
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="enabled"
                    value="1"
                    defaultChecked={current.enabled}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-ink">
                      {t("assistant.field.enabled")}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {t("assistant.field.enabledHint")}
                    </span>
                  </span>
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t("assistant.field.provider")}
                    htmlFor="assistant-provider"
                    hint={t("assistant.field.providerHint")}
                  >
                    <Select
                      id="assistant-provider"
                      name="provider"
                      defaultValue={current.provider}
                    >
                      {ASSISTANT_PROVIDERS.map((provider) => (
                        <option key={provider} value={provider}>
                          {t(`assistant.provider.${provider}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label={t("assistant.field.model")}
                    htmlFor="assistant-model"
                    hint={t("assistant.field.modelHint")}
                  >
                    <Input
                      id="assistant-model"
                      name="model"
                      defaultValue={current.model ?? ""}
                    />
                  </Field>
                  <Field
                    label={t("assistant.field.credentialRef")}
                    htmlFor="assistant-credential"
                    hint={t("assistant.field.credentialRefHint")}
                  >
                    <Input
                      id="assistant-credential"
                      name="credentialRef"
                      defaultValue={current.credentialRef ?? ""}
                      className="font-mono"
                    />
                  </Field>
                  <Field
                    label={t("assistant.field.baseUrl")}
                    htmlFor="assistant-base-url"
                    hint={t("assistant.field.baseUrlHint")}
                  >
                    <Input
                      id="assistant-base-url"
                      name="baseUrl"
                      type="url"
                      defaultValue={current.baseUrl ?? ""}
                    />
                  </Field>
                  <Field
                    label={t("assistant.field.displayName")}
                    htmlFor="assistant-display-name"
                    hint={t("assistant.field.displayNameHint")}
                  >
                    <Input
                      id="assistant-display-name"
                      name="displayName"
                      defaultValue={current.displayName ?? ""}
                    />
                  </Field>
                  <Field
                    label={t("assistant.field.maxOutputTokens")}
                    htmlFor="assistant-max-output"
                    hint={t("assistant.field.maxOutputTokensHint")}
                  >
                    <Input
                      id="assistant-max-output"
                      name="maxOutputTokens"
                      inputMode="numeric"
                      defaultValue={String(current.maxOutputTokens)}
                    />
                  </Field>
                </div>

                <p className="text-sm">
                  {current.provider === "none" ? (
                    <span className="text-ink-muted">{t("assistant.credential.none")}</span>
                  ) : current.credentialPresent ? (
                    <span className="text-success">
                      {t("assistant.credential.found", {
                        name: current.credentialRef ?? "",
                      })}
                    </span>
                  ) : (
                    <span className="text-danger">
                      {t("assistant.credential.missing", {
                        name: current.credentialRef ?? "",
                      })}
                    </span>
                  )}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t("assistant.limits")} />
              <CardBody>
                <p className="max-w-prose text-sm text-ink-muted">
                  {t("assistant.limitsHint")}
                </p>

                <div className="grid gap-2">
                  <div
                    role="meter"
                    aria-valuenow={spentShare}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t("assistant.spend.meter", { percent: spentShare })}
                    className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
                  >
                    <div
                      className={
                        spentShare >= 100
                          ? "h-full bg-danger"
                          : spentShare >= 80
                            ? "h-full bg-warning"
                            : "h-full bg-accent"
                      }
                      style={{ width: `${spentShare}%` }}
                    />
                  </div>
                  <p className="text-sm text-ink-muted tabular-nums">
                    {t("assistant.spend.used", {
                      spent: money(current.spentCents),
                      cap: money(current.spendCapCents),
                      period: t(`assistant.period.${current.spendPeriod}`),
                    })}
                  </p>
                  {!current.priced ? (
                    <p className="text-sm text-warning">{t("assistant.unpriced")}</p>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t("assistant.field.spendCap")}
                    htmlFor="assistant-spend-cap"
                    hint={t("assistant.field.spendCapHint", {
                      example: money(2_000),
                    })}
                  >
                    <Input
                      id="assistant-spend-cap"
                      name="spendCapCents"
                      inputMode="numeric"
                      defaultValue={String(current.spendCapCents)}
                    />
                  </Field>
                  <Field
                    label={t("assistant.field.spendPeriod")}
                    htmlFor="assistant-spend-period"
                    hint={t("assistant.field.spendPeriodHint")}
                  >
                    <Select
                      id="assistant-spend-period"
                      name="spendPeriod"
                      defaultValue={current.spendPeriod}
                    >
                      {ASSISTANT_SPEND_PERIODS.map((period) => (
                        <option key={period} value={period}>
                          {t(`assistant.period.${period}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label={t("assistant.field.repliesPerConversation")}
                    htmlFor="assistant-replies-conversation"
                    hint={t("assistant.field.repliesPerConversationHint")}
                  >
                    <Input
                      id="assistant-replies-conversation"
                      name="repliesPerConversation"
                      inputMode="numeric"
                      defaultValue={String(current.repliesPerConversation)}
                    />
                  </Field>
                  <Field
                    label={t("assistant.field.repliesPerHour")}
                    htmlFor="assistant-replies-hour"
                    hint={t("assistant.field.repliesPerHourHint", {
                      used: current.repliesThisHour,
                    })}
                  >
                    <Input
                      id="assistant-replies-hour"
                      name="repliesPerHour"
                      inputMode="numeric"
                      defaultValue={String(current.repliesPerHour)}
                    />
                  </Field>
                  <Field
                    label={t("assistant.field.inputPrice")}
                    htmlFor="assistant-input-price"
                    hint={t("assistant.field.priceHint")}
                  >
                    <Input
                      id="assistant-input-price"
                      name="inputCentsPerMillion"
                      inputMode="numeric"
                      defaultValue={
                        current.inputCentsPerMillion === null
                          ? ""
                          : String(current.inputCentsPerMillion)
                      }
                    />
                  </Field>
                  <Field
                    label={t("assistant.field.outputPrice")}
                    htmlFor="assistant-output-price"
                    hint={t("assistant.field.priceHint")}
                  >
                    <Input
                      id="assistant-output-price"
                      name="outputCentsPerMillion"
                      inputMode="numeric"
                      defaultValue={
                        current.outputCentsPerMillion === null
                          ? ""
                          : String(current.outputCentsPerMillion)
                      }
                    />
                  </Field>
                </div>

                <div>
                  <Button type="submit">{t("assistant.action.save")}</Button>
                </div>
              </CardBody>
            </Card>
          </form>

          <Card>
            <CardHeader title={t("assistant.scopes")} />
            <CardBody>
              <p className="max-w-prose text-sm text-ink-muted">
                {t("assistant.scopesHint")}
              </p>
              <ul className="grid list-none gap-2 p-0">
                {(grants ?? []).map((grant) => (
                  <li
                    key={grant.action}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rule p-3 text-sm"
                  >
                    <span className="grid gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">
                          {t(`assistant.scope.${grant.action}`)}
                        </span>
                        <Pill tone={grant.enabled ? "success" : "neutral"}>
                          {grant.enabled
                            ? t("assistant.scope.on")
                            : t("assistant.scope.off")}
                        </Pill>
                        {grant.writes ? (
                          <Pill tone="warning">{t("assistant.scope.writes")}</Pill>
                        ) : null}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {t(`assistant.scopeHint.${grant.action}`)}
                      </span>
                      <span className="font-mono text-xs text-ink-muted">
                        {grant.service}
                      </span>
                    </span>
                    {grant.available ? (
                      <form action={setAssistantScopeAction}>
                        <input type="hidden" name="action" value={grant.action} />
                        <input
                          type="hidden"
                          name="enabled"
                          value={grant.enabled ? "0" : "1"}
                        />
                        <Button type="submit" variant="quiet">
                          {grant.enabled
                            ? t("assistant.action.revoke")
                            : t("assistant.action.grant")}
                        </Button>
                      </form>
                    ) : (
                      <span className="text-xs text-ink-muted">
                        {t("assistant.scope.unavailable")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("assistant.knowledge")} />
            <CardBody>
              <p className="max-w-prose text-sm text-ink-muted">
                {t("assistant.knowledgeHint")}
              </p>
              {facts && facts.length > 0 ? (
                <ul className="mt-3 grid list-none gap-2 p-0">
                  {facts.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-rule p-3 text-sm"
                    >
                      <div className="grid gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{entry.title}</span>
                          <Pill tone={entry.enabled ? "success" : "neutral"}>
                            {entry.enabled
                              ? t("assistant.knowledge.on")
                              : t("assistant.knowledge.off")}
                          </Pill>
                          <span className="text-xs text-ink-muted">
                            {t(`assistant.knowledgeKind.${entry.kind}`)} · {entry.locale}
                          </span>
                        </span>
                        <span className="text-ink-muted">{entry.body}</span>
                      </div>
                      <form action={deleteKnowledgeAction}>
                        <input type="hidden" name="id" value={entry.id} />
                        <Button type="submit" variant="quiet">
                          {t("assistant.action.deleteKnowledge")}
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">{t("assistant.knowledgeEmpty")}</p>
              )}
              <form action={saveKnowledgeAction} className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label={t("assistant.field.knowledgeTitle")} htmlFor="knowledge-title">
                  <Input id="knowledge-title" name="title" required maxLength={200} />
                </Field>
                <Field label={t("assistant.field.knowledgeKind")} htmlFor="knowledge-kind">
                  <Select id="knowledge-kind" name="kind" defaultValue="fact">
                    {KNOWLEDGE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`assistant.knowledgeKind.${kind}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("assistant.field.knowledgeLocale")} htmlFor="knowledge-locale">
                  <Input id="knowledge-locale" name="locale" defaultValue={locale} required />
                </Field>
                <label className="flex items-end gap-2 text-sm">
                  <input type="checkbox" name="enabled" value="1" defaultChecked />
                  {t("assistant.field.knowledgeEnabled")}
                </label>
                <Field
                  label={t("assistant.field.knowledgeBody")}
                  htmlFor="knowledge-body"
                  hint={t("assistant.field.knowledgeBodyHint")}
                >
                  <textarea
                    id="knowledge-body"
                    name="body"
                    required
                    rows={3}
                    maxLength={4000}
                    className="w-full rounded-md border border-rule bg-field px-3 py-2 text-sm"
                  />
                </Field>
                <div className="flex items-end">
                  <Button type="submit">{t("assistant.action.saveKnowledge")}</Button>
                </div>
              </form>
              <form action={reindexAssistantAction} className="mt-3">
                <Button type="submit" variant="quiet">
                  {t("assistant.action.reindex")}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("assistant.turns")} />
            <CardBody>
              <p className="max-w-prose text-sm text-ink-muted">
                {t("assistant.turnsHint")}
              </p>
              {(attempts ?? []).length === 0 ? (
                <p className="max-w-prose text-sm text-ink-muted">
                  {t("assistant.turnsEmpty")}
                </p>
              ) : (
                <ul className="grid list-none gap-2 p-0">
                  {(attempts ?? []).map((attempt) => (
                    <li
                      key={attempt.id}
                      className="grid gap-1 rounded-md border border-rule p-3 text-sm"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Pill tone={OUTCOME_TONES[attempt.outcome]}>
                          {t(`assistant.outcome.${attempt.outcome}`)}
                        </Pill>
                        <span className="text-ink-muted">{when(attempt.createdAt)}</span>
                        <span className="text-ink-muted tabular-nums">
                          {money(attempt.costCents)}
                        </span>
                        {attempt.model ? (
                          <span className="font-mono text-xs text-ink-muted">
                            {attempt.model}
                          </span>
                        ) : null}
                        {attempt.action ? (
                          <span className="font-mono text-xs text-ink-muted">
                            {attempt.action}
                          </span>
                        ) : null}
                      </span>
                      {attempt.detail ? (
                        <span className="text-ink-muted">{attempt.detail}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
