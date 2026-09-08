// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The update surface (MASTER.md §39.10, C10.20).
//
// §39.10: "Admin — a status line that is never ambiguous: *'Up to date'*,
// *'Update available'*, or *'2 security releases behind — CVSS 8.1'* in the
// danger colour, with the notes and one button."
//
// This screen is also where a debt is paid. C10.01 through C10.11 each shipped
// with their F04 recorded as a Doctor check "not a new admin screen (C10.11)"
// — eleven items whose human surface was deferred to one line. An owner cannot
// be expected to run `doctor` to find out they are two security releases
// behind, so everything those items built is visible here: the seams, the
// channel and policy, the signed feed, the preflight, the run history, the
// snapshots, the per-target strategy and the fork lane.
import type { Metadata } from "next";
import {
  ArrowsClockwise,
  CheckCircle,
  GitBranch,
  ShieldWarning,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import {
  describeUpdateTargets,
  forkStatus,
  getUpdatePolicy,
  listAvailableReleases,
  listUpdateRuns,
  updateStatus,
} from "@/core/update/service";
import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
  Select,
} from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { UpdateActionForm } from "./UpdateActionForm";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("updates.title"), robots: { index: false, follow: false } };
}

const WINDOW_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export default async function UpdatesPage() {
  const actor = await requireStaffActor("platform");
  const [status, releases, policy, history, targets, business, t] = await Promise.all([
    updateStatus.call({}, actor),
    listAvailableReleases.call({}, actor),
    getUpdatePolicy.call({}, actor),
    listUpdateRuns.call({ limit: 20 }, actor),
    describeUpdateTargets.call({}, actor),
    currentBusiness(),
    getT(),
  ]);

  // The fork lane spawns a process and may reach the network, so it is asked
  // for separately and is allowed to fail without taking the page with it: an
  // instance on the image lane must still be able to read its update status.
  const fork = await forkStatus.call({}, actor).catch(() => null);

  const zone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const when = (value: Date | string | null) =>
    value === null ? t("updates.never") : formatDateTime(new Date(value), zone, locale);

  const tone =
    status.posture === "behind-security"
      ? ("danger" as const)
      : status.posture === "behind"
        ? ("accent" as const)
        : status.posture === "unknown"
          ? ("warning" as const)
          : ("success" as const);
  const icon =
    status.posture === "behind-security" ? (
      <ShieldWarning size={17} weight="fill" />
    ) : status.posture === "current" ? (
      <CheckCircle size={17} weight="fill" />
    ) : (
      <WarningCircle size={17} weight="fill" />
    );

  const newest = status.missing.at(-1) ?? null;
  const runTone = (statusValue: string) =>
    statusValue === "completed"
      ? ("success" as const)
      : statusValue === "failed"
        ? ("danger" as const)
        : statusValue === "rolled_back"
          ? ("warning" as const)
          : ("neutral" as const);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("updates.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("updates.intro")}</p>
      </div>

      {/* The status line §39.10 says must never be ambiguous. */}
      <Callout tone={tone} icon={icon}>
        {status.sentence}
      </Callout>

      <Card>
        <CardHeader
          title={t("updates.thisInstance")}
          status={<Pill tone="neutral">{status.currentVersion}</Pill>}
        />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-ink-muted">{t("updates.channel")}</dt>
              <dd className="text-sm text-ink">{policy.channel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">{t("updates.lastChecked")}</dt>
              <dd className="text-sm text-ink">{when(status.lastCheckedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">{t("updates.target")}</dt>
              <dd className="text-sm text-ink">
                {targets.thisTarget ?? t("updates.noTarget")}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">
                {t("updates.rollbackHorizon")}
              </dt>
              <dd className="text-sm text-ink">
                {status.earliestReachableVersion ?? t("updates.horizonNone")}
              </dd>
            </div>
          </dl>

          {/* Stated, not implied: an instance with no declared recipe migrates
              and smokes but swaps nothing, and an owner who thinks otherwise
              will believe an update landed when it did not. */}
          {targets.swaps ? null : (
            <Callout tone="warning" icon={<WarningCircle size={17} weight="fill" />}>
              {t("updates.noTargetWarning")}
            </Callout>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <UpdateActionForm
              intent="check"
              variant="quiet"
              submitLabel={t("updates.action.check")}
              pendingLabel={t("updates.action.checking")}
            />
            {newest ? (
              <UpdateActionForm
                intent="preflight"
                variant="quiet"
                hidden={{ version: newest.version }}
                submitLabel={t("updates.action.preflight")}
                pendingLabel={t("updates.action.preflighting")}
              />
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* The one button. */}
      {newest ? (
        <Card>
          <CardHeader
            title={t("updates.available")}
            status={
              <Pill tone={status.urgent ? "danger" : "accent"}>{newest.version}</Pill>
            }
          />
          <CardBody>
            <p className="max-w-prose text-sm text-ink-muted">
              {t("updates.availableIntro", { version: newest.version })}
            </p>
            <p className="mt-2 text-sm">
              <a
                className="text-accent underline"
                href={newest.notesUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                {t("updates.releaseNotes")}
              </a>
            </p>
            <div className="mt-4">
              <UpdateActionForm
                intent="apply"
                hidden={{ version: newest.version }}
                variant={status.urgent ? "danger" : "primary"}
                confirm={t("updates.applyConfirm", { version: newest.version })}
                submitLabel={t("updates.action.apply", { version: newest.version })}
                pendingLabel={t("updates.action.applying")}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("updates.feed")} />
        <CardBody>
          {releases.releases.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("updates.feedEmpty")}</p>
          ) : (
            <ul className="grid list-none gap-4 p-0">
              {releases.releases.map((release) => (
                <li
                  key={release.version}
                  className="grid gap-1 border-b border-rule pb-4 last:border-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ink">{release.version}</span>
                    <Pill tone="neutral">{release.channel}</Pill>
                    {release.cvss === null ? null : (
                      <Pill tone={release.cvss >= 7 ? "danger" : "warning"}>
                        {t("updates.cvss", { score: release.cvss })}
                      </Pill>
                    )}
                    {release.schemaBreaking ? (
                      <Pill tone="warning">{t("updates.schemaBreaking")}</Pill>
                    ) : null}
                    {release.verified ? null : (
                      <Pill tone="danger">{t("updates.unverified")}</Pill>
                    )}
                    <span className="ms-auto text-xs text-ink-muted">
                      {when(release.publishedAt)}
                    </span>
                  </div>
                  {/* Applicability per row: a list of releases an owner cannot
                      apply from their version teaches them to ignore it. */}
                  <span className="text-xs text-ink-muted">{release.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("updates.policy")}
          status={
            policy.paused ? (
              <Pill tone="warning">{t("updates.paused")}</Pill>
            ) : (
              <Pill tone={policy.inWindow ? "success" : "neutral"}>
                {policy.inWindow ? t("updates.inWindow") : t("updates.outOfWindow")}
              </Pill>
            )
          }
        />
        <CardBody>
          <p className="mb-4 max-w-prose text-sm text-ink-muted">
            {t("updates.policyIntro", { zone: policy.timezone })}
          </p>
          <UpdateActionForm
            intent="savePolicy"
            submitLabel={t("updates.action.savePolicy")}
            pendingLabel={t("updates.action.saving")}
          >
            <Field label={t("updates.field.channel")} htmlFor="channel">
              <Select id="channel" name="channel" defaultValue={policy.channel}>
                <option value="security">{t("updates.channel.security")}</option>
                <option value="stable">{t("updates.channel.stable")}</option>
                <option value="edge">{t("updates.channel.edge")}</option>
                <option value="off">{t("updates.channel.off")}</option>
              </Select>
            </Field>
            <Field label={t("updates.field.applyLevel")} htmlFor="applyLevel">
              <Select id="applyLevel" name="applyLevel" defaultValue={policy.applyLevel}>
                <option value="security">{t("updates.apply.security")}</option>
                <option value="patch">{t("updates.apply.patch")}</option>
                <option value="minor">{t("updates.apply.minor")}</option>
                <option value="none">{t("updates.apply.none")}</option>
              </Select>
            </Field>
            <fieldset className="grid gap-2 border-0 p-0">
              <legend className="text-xs font-medium text-ink-muted">
                {t("updates.field.windowDays")}
              </legend>
              <div className="flex flex-wrap gap-3">
                {WINDOW_DAYS.map((day) => (
                  <label key={day} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      name="windowDays"
                      value={day}
                      defaultChecked={policy.window.days.includes(day)}
                    />
                    {t(`updates.day.${day}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={t("updates.field.windowStart")} htmlFor="windowStart">
              <Input
                id="windowStart"
                name="windowStart"
                type="time"
                defaultValue={policy.window.start}
              />
            </Field>
            <Field label={t("updates.field.keepSnapshots")} htmlFor="keepSnapshots">
              <Input
                id="keepSnapshots"
                name="keepSnapshots"
                type="number"
                min={1}
                max={50}
                defaultValue={policy.keepSnapshots}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="drain" defaultChecked={policy.drain} />
              {t("updates.field.drain")}
            </label>
            <fieldset className="grid gap-2 border-0 p-0">
              <legend className="text-xs font-medium text-ink-muted">
                {t("updates.field.notify")}
              </legend>
              <div className="flex flex-wrap gap-3">
                {(["email", "sms"] as const).map((channel) => (
                  <label key={channel} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      name="notifyChannels"
                      value={channel}
                      defaultChecked={policy.notifyChannels.includes(channel)}
                    />
                    {t(`updates.notify.${channel}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          </UpdateActionForm>

          <div className="mt-6 border-t border-rule pt-4">
            <p className="mb-3 max-w-prose text-sm text-ink-muted">
              {policy.paused
                ? t("updates.pausedUntil", { value: when(policy.pausedUntil) })
                : t("updates.pauseIntro")}
            </p>
            <UpdateActionForm
              intent={policy.paused ? "resume" : "pause"}
              variant="quiet"
              submitLabel={
                policy.paused ? t("updates.action.resume") : t("updates.action.pause")
              }
              pendingLabel={t("updates.action.saving")}
            />
          </div>
        </CardBody>
      </Card>

      {/* §39.8: updating means different things per target, and the owner
          deciding whether to leave it on overnight should know which. */}
      <Card>
        <CardHeader title={t("updates.targets")} />
        <CardBody>
          <ul className="grid list-none gap-3 p-0">
            {targets.targets.map((entry) => (
              <li
                key={entry.target}
                className="grid gap-1 border-b border-rule pb-3 last:border-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-ink">{entry.target}</span>
                  <Pill tone={entry.target === targets.thisTarget ? "accent" : "neutral"}>
                    {entry.strategy}
                  </Pill>
                  <span className="ms-auto text-xs text-ink-muted">
                    {t("updates.cutover", { cost: entry.cutoverCost })}
                  </span>
                </div>
                <span className="text-xs text-ink-muted">{entry.means}</span>
                <span className="text-xs text-ink-muted">
                  {t("updates.rollbackNeeds", { artifact: entry.rollbackArtifact })}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {fork?.fork ? (
        <Card>
          <CardHeader
            title={t("updates.fork")}
            status={
              <Pill tone={fork.status === "behind-security" ? "danger" : "neutral"}>
                <GitBranch size={13} weight="bold" /> {fork.status}
              </Pill>
            }
          />
          <CardBody>
            <p className="max-w-prose text-sm text-ink">{fork.sentence}</p>
            {fork.ownedByYou.length > 0 ? (
              <p className="mt-3 max-w-prose text-xs text-ink-muted">
                {t("updates.forkOwned", { count: fork.ownedByYou.length })}
              </p>
            ) : null}
            {fork.replaceableCore.length > 0 ? (
              <p className="mt-1 max-w-prose text-xs text-ink-muted">
                {t("updates.forkCore", { count: fork.replaceableCore.length })}
              </p>
            ) : null}
            <div className="mt-4">
              <UpdateActionForm
                intent="forkUpdate"
                variant="quiet"
                submitLabel={t("updates.action.forkUpdate")}
                pendingLabel={t("updates.action.forkOpening")}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={t("updates.history")}
          status={
            <Pill tone="neutral">
              <ArrowsClockwise size={13} weight="bold" /> {history.runs.length}
            </Pill>
          }
        />
        <CardBody>
          {history.runs.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("updates.historyEmpty")}</p>
          ) : (
            <ul className="grid list-none gap-3 p-0">
              {history.runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-2 border-b border-rule pb-3 last:border-0"
                >
                  <span className="font-mono text-sm text-ink">
                    {run.fromVersion} → {run.toVersion}
                  </span>
                  <Pill tone={runTone(run.status)}>{run.status}</Pill>
                  <Pill tone="neutral">{run.trigger}</Pill>
                  <span className="ms-auto text-xs text-ink-muted">
                    {when(run.startedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {history.notes.length > 0 ? (
            <ul className="mt-6 grid list-none gap-2 p-0 border-t border-rule pt-4">
              {history.notes.map((note) => (
                <li key={note.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink">{note.title}</span>
                  <span className="ms-auto text-xs text-ink-muted">
                    {when(note.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
