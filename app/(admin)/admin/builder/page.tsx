// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner brief → proposal → preview → explicit approval → rollback (C4.19).
import { MagicWand, ShieldCheck, Sparkle } from "@phosphor-icons/react/dist/ssr";
import { builderStatus, getProposal, listProposals } from "@/modules/builder/service";
import { Button, Callout, Card, CardBody, CardHeader, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import {
  applyProposalAction,
  proposeSiteAction,
  rejectProposalAction,
  rollbackProposalAction,
} from "../../builder-actions";
import { requireOwnerActor } from "../guard";

export const dynamic = "force-dynamic";

type Params = {
  proposal?: string;
  notice?: string;
  error?: string;
};

const toneFor = (status: string) =>
  status === "applied" ? "success" as const
    : status === "ready" ? "accent" as const
      : status === "stale" ? "warning" as const
        : "neutral" as const;

export default async function BuilderPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requireOwnerActor("builder");
  const params = await searchParams;
  const [status, recent, t] = await Promise.all([
    builderStatus.call({}, actor),
    listProposals.call({}, actor),
    getT(),
  ]);
  const selectedId = params.proposal ?? recent[0]?.id;
  const selected = selectedId ? await getProposal.call({ id: selectedId }, actor) : null;
  const diffs = (selected?.diff ?? []) as Array<{ target: string; label: string; before?: { blocks?: unknown[] } | null; after?: { blocks?: unknown[] } }>;
  const percent = status.monthlyTokenBudget > 0
    ? Math.min(100, Math.round((status.usedTokens / status.monthlyTokenBudget) * 100))
    : 100;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">
            <Sparkle size={15} weight="fill" /> {t("builder.eyebrow")}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("builder.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">{t("builder.intro")}</p>
        </div>
        <Pill tone={status.configured ? "success" : "danger"}>
          {status.configured ? t("builder.ready") : t("builder.notConfigured")}
        </Pill>
      </div>

      {params.notice ? <Callout tone="success" icon={<ShieldCheck size={17} />}>{params.notice}</Callout> : null}
      {params.error ? <Callout tone="danger">{params.error}</Callout> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader icon={<MagicWand size={18} />} title={t("builder.briefTitle")} />
          <CardBody>
            <form action={proposeSiteAction} className="grid gap-4">
              <div className="grid gap-1.5">
                <label htmlFor="builder-brief" className="font-mono text-xs font-medium text-ink-muted">
                  {t("builder.briefLabel")}
                </label>
                <textarea
                  id="builder-brief"
                  name="brief"
                  required
                  minLength={3}
                  maxLength={5000}
                  rows={7}
                  placeholder={t("builder.briefPlaceholder")}
                  className="w-full resize-y rounded-md border border-rule bg-field px-3 py-3 text-sm text-ink placeholder:text-ink-muted focus-visible:border-accent"
                />
                <p className="text-xs text-ink-muted">{t("builder.briefHint")}</p>
              </div>
              <Button type="submit" disabled={!status.configured} className="w-fit">
                <Sparkle size={16} weight="fill" /> {t("builder.propose")}
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("builder.budgetTitle")} status={<span className="font-mono text-xs">{percent}%</span>} />
          <CardBody>
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-label={t("builder.budgetTitle")}>
              <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-ink-muted">{t("builder.used")}</dt>
              <dd className="text-end font-mono">{status.usedTokens.toLocaleString()}</dd>
              <dt className="text-ink-muted">{t("builder.remaining")}</dt>
              <dd className="text-end font-mono">{status.remainingTokens.toLocaleString()}</dd>
              <dt className="text-ink-muted">{t("builder.adapter")}</dt>
              <dd className="text-end font-mono">{status.adapter}</dd>
            </dl>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t("builder.recent")} />
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-sm text-ink-muted">{t("builder.empty")}</p>
          ) : (
            <ul className="grid list-none p-0">
              {recent.map((proposal) => (
                <li key={proposal.id} className="border-b border-rule last:border-0">
                  <a
                    href={`/admin/builder?proposal=${proposal.id}`}
                    aria-current={selected?.id === proposal.id ? "true" : undefined}
                    className={`grid gap-1 px-4 py-3 text-sm ${selected?.id === proposal.id ? "bg-accent-soft" : ""}`}
                  >
                    <span className="font-medium leading-snug">{proposal.summary}</span>
                    <span className="flex items-center gap-2">
                      <Pill tone={toneFor(proposal.status)}>{t(`builder.status.${proposal.status}`)}</Pill>
                      <span className="font-mono text-[0.68rem] text-ink-muted">{t(`builder.lane.${proposal.lane}`)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected ? (
          <Card>
            <CardHeader
              title={selected.summary}
              status={<Pill tone={toneFor(selected.status)}>{t(`builder.status.${selected.status}`)}</Pill>}
            />
            <CardBody>
              <div>
                <p className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{t("builder.ownerBrief")}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{selected.brief}</p>
              </div>
              <div>
                <p className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{t("builder.rationale")}</p>
                <p className="mt-2 text-sm text-ink-muted">{selected.rationale}</p>
              </div>
              {selected.lane === "vocabulary" ? (
                <Callout tone="warning">{t("builder.vocabularyLane")}</Callout>
              ) : null}
              {diffs.length > 0 ? (
                <div className="grid gap-2">
                  <p className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{t("builder.changes")}</p>
                  <ul className="grid list-none gap-2 p-0">
                    {diffs.map((entry, index) => (
                      <li key={`${entry.target}:${entry.label}:${index}`} className="flex flex-wrap items-center gap-2 rounded-md border border-rule px-3 py-2 text-sm">
                        <Pill>{t(`builder.target.${entry.target}`)}</Pill>
                        <span className="font-mono">{entry.label}</span>
                        <span className="ms-auto text-xs text-ink-muted">
                          {t("builder.blockCountChange", {
                            before: entry.before?.blocks?.length ?? 0,
                            after: entry.after?.blocks?.length ?? 0,
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <a href={`/admin/builder/proposals/${selected.id}`} className="w-fit text-sm font-semibold text-accent underline underline-offset-2">
                    {t("builder.preview")}
                  </a>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3 border-t border-rule pt-4">
                {selected.status === "ready" ? (
                  <>
                    {selected.lane === "structure" ? (
                    <form action={applyProposalAction}>
                      <input type="hidden" name="id" value={selected.id} />
                      <Button type="submit">{t("builder.apply")}</Button>
                    </form>
                    ) : null}
                    <form action={rejectProposalAction}>
                      <input type="hidden" name="id" value={selected.id} />
                      <Button type="submit" variant="quiet">{t("builder.reject")}</Button>
                    </form>
                  </>
                ) : null}
                {selected.status === "applied" ? (
                  <form action={rollbackProposalAction}>
                    <input type="hidden" name="id" value={selected.id} />
                    <Button type="submit" variant="quiet">{t("builder.rollback")}</Button>
                  </form>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ) : (
          <Callout>{t("builder.empty")}</Callout>
        )}
      </div>
    </div>
  );
}
