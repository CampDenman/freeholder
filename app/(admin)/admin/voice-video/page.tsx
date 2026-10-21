// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Voice and video rooms, recordings and transcripts (MASTER.md §4.14).
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { listContacts } from "@/core/contacts/service";
import {
  voiceVideoAdminConfiguration,
  listVoiceVideoArtifacts,
  listVoiceVideoJoins,
  listVoiceVideoRooms,
} from "../../../../plugins/voice-video/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  voiceVideoConfigureAction,
  voiceVideoDownloadAction,
  voiceVideoHostAction,
  voiceVideoImportAction,
  voiceVideoRecordingAction,
  joinVoiceVideoAction,
  missVoiceVideoAction,
  recordVoiceVideoAction,
  startVoiceVideoAction,
  stopVoiceVideoAction,
} from "../../first-party-plugin-actions";

import { GuestInvite } from "./GuestInvite";
import { HostJoin } from "./HostJoin";
import { VerifyConnection } from "./VerifyConnection";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function VoiceVideoPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; room?: string }>;
}) {
  const actor = await requireStaffActor("voiceVideo", "manage");
  const query = await searchParams;
  const [t, rooms, artifacts, people, configuration] = await Promise.all([
    getT(),
    domainOrNull(listVoiceVideoRooms.call({}, actor)),
    domainOrNull(listVoiceVideoArtifacts.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
    domainOrNull(voiceVideoAdminConfiguration.call({}, actor)),
  ]);
  const chosen =
    (rooms ?? []).find((row) => row.id === query.room) ?? (rooms ?? [])[0] ?? null;
  const joins = chosen
    ? await domainOrNull(listVoiceVideoJoins.call({ roomId: chosen.id }, actor))
    : [];
  const recordings = (artifacts ?? []).filter((row) => row.kind !== "transcript");
  const provider = configuration?.provider ?? "paradise";
  const credentialLabels = {
    serverLabel: t("voiceVideo.credential.server"),
    tokenLabel: t("voiceVideo.credential.token"),
    iceLabel: t("voiceVideo.credential.ice"),
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("voiceVideo.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("voiceVideo.intro")}</p>
      </div>
      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("voiceVideo.saved")}
        </p>
      ) : null}
      {query.error ? (
        <p className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {query.error}
        </p>
      ) : null}
      <Card>
        <CardHeader title={t("voiceVideo.setup")} />
        <CardBody>
          <p className="text-sm text-ink-muted">{t("voiceVideo.setupHelpParadise")}</p>
          <form action={voiceVideoConfigureAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t("voiceVideo.field.provider")} htmlFor="vv-provider">
              <Select id="vv-provider" name="provider" defaultValue={provider}>
                <option value="paradise">{t("voiceVideo.provider.paradise")}</option>
                <option value="daily">{t("voiceVideo.provider.daily")}</option>
              </Select>
            </Field>
            <Field label={t("voiceVideo.field.authScheme")} htmlFor="vv-auth-scheme">
              <Select id="vv-auth-scheme" name="authScheme" defaultValue={configuration?.paradise.authScheme ?? "site_key"}>
                <option value="site_key">{t("voiceVideo.authScheme.siteKey")}</option>
                <option value="portfolio_token">{t("voiceVideo.authScheme.portfolioToken")}</option>
              </Select>
            </Field>
            <Field label={t("voiceVideo.field.baseUrl")} htmlFor="vv-base-url">
              <Input id="vv-base-url" name="baseUrl" defaultValue={configuration?.paradise.baseUrl ?? ""} />
            </Field>
            <Field label={t("voiceVideo.field.roomPolicy")} htmlFor="vv-room-policy">
              <Select id="vv-room-policy" name="roomPolicy" defaultValue={configuration?.paradise.roomPolicy ?? "invite_only"}>
                <option value="invite_only">{t("voiceVideo.policy.inviteOnly")}</option>
                <option value="moderated">{t("voiceVideo.policy.moderated")}</option>
                <option value="open">{t("voiceVideo.policy.open")}</option>
              </Select>
            </Field>
            <Field label={t("voiceVideo.field.apiKey")} htmlFor="vv-api-key">
              <Input id="vv-api-key" name="apiKey" type="password" autoComplete="off"
                placeholder={configuration?.paradise.hasApiKey ? t("voiceVideo.secretStored") : undefined} />
            </Field>
            <Field label={t("voiceVideo.field.portfolioToken")} htmlFor="vv-portfolio-token">
              <Input id="vv-portfolio-token" name="portfolioToken" type="password" autoComplete="off"
                placeholder={configuration?.paradise.hasPortfolioToken ? t("voiceVideo.secretStored") : undefined} />
            </Field>
            <Field label={t("voiceVideo.field.webhookSecret")} htmlFor="vv-webhook-secret">
              <Input id="vv-webhook-secret" name="webhookSecret" type="password" autoComplete="off"
                placeholder={configuration?.paradise.hasWebhookSecret ? t("voiceVideo.secretStored") : undefined} />
            </Field>
            <Field label={t("voiceVideo.field.retentionDays")} htmlFor="vv-retention">
              <Input id="vv-retention" name="retentionDays" inputMode="numeric"
                defaultValue={configuration?.paradise.retentionDays ?? ""} placeholder={t("voiceVideo.retentionHint")} />
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit">{t("voiceVideo.saveSettings")}</Button>
              <VerifyConnection label={t("voiceVideo.verify")} topUpLabel={t("voiceVideo.topUp")} />
            </div>
          </form>
          <p className="mt-3 text-sm text-ink-muted">
            {provider === "daily"
              ? t(configuration?.dailyConfigured ? "voiceVideo.configured" : "voiceVideo.setupHelpDaily", { domain: configuration?.dailyDomain ?? "" })
              : t("voiceVideo.webhookSetup", { url: "/api/plugins/voice-video/webhooks/paradise" })}
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("voiceVideo.start")} />
        <CardBody>
          <form action={startVoiceVideoAction} className="grid gap-3 sm:grid-cols-2">
            <Field label={t("voiceVideo.field.contact")} htmlFor="vv-contact">
              <Select id="vv-contact" name="contactId" required>
                <option value="">{t("voiceVideo.field.contact")}</option>
                {(people?.rows ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("voiceVideo.field.kind")} htmlFor="vv-kind">
              <Select id="vv-kind" name="kind" defaultValue="voice">
                <option value="voice">{t("voiceVideo.kind.voice")}</option>
                <option value="video">{t("voiceVideo.kind.video")}</option>
              </Select>
            </Field>
            <Field label={t("voiceVideo.field.title")} htmlFor="vv-title">
              <Input id="vv-title" name="title" required />
            </Field>
            <Field label={t("voiceVideo.field.provider")} htmlFor="vv-start-provider">
              <Select id="vv-start-provider" name="provider" defaultValue={provider}>
                <option value="paradise">{t("voiceVideo.provider.paradise")}</option>
                <option value="daily">{t("voiceVideo.provider.daily")}</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">{t("voiceVideo.start")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("voiceVideo.rooms")} />
        <CardBody>
          {(rooms ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("voiceVideo.emptyRooms")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(rooms ?? []).map((room) => (
                <li key={room.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <a className="font-medium text-accent" href={`/admin/voice-video?room=${room.id}`}>
                    {room.title}
                  </a>
                  <Pill
                    tone={
                      room.status === "live" || room.status === "ended"
                        ? "success"
                        : room.status === "failed" || room.status === "missed"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {t(`voiceVideo.status.${room.status}`)}
                  </Pill>
                  {room.lastError ? <span className="text-danger">{room.lastError}</span> : null}
                  {room.status === "live" ? (
                    <>
                      {room.provider === "paradise" ? (
                        <HostJoin roomId={room.id} hostName={t("voiceVideo.hostName")} label={t("voiceVideo.openHost")}
                          credentialHelp={t("voiceVideo.credentialHelp")} credentialLabels={credentialLabels} />
                      ) : (
                        <form action={voiceVideoHostAction}>
                          <input type="hidden" name="roomId" value={room.id} />
                          <input type="hidden" name="hostName" value={t("voiceVideo.hostName")} />
                          <Button type="submit" variant="quiet">{t("voiceVideo.openHost")}</Button>
                        </form>
                      )}
                      <GuestInvite roomId={room.id} label={t("voiceVideo.invite")} help={t("voiceVideo.inviteHelp")}
                        credentialHelp={t("voiceVideo.credentialHelp")} credentialLabels={credentialLabels} />
                      {room.provider === "paradise" ? (
                        <>
                          <form action={voiceVideoRecordingAction}>
                            <input type="hidden" name="roomId" value={room.id} />
                            <input type="hidden" name="action" value="start" />
                            <Button type="submit" variant="quiet">{t("voiceVideo.startRecording")}</Button>
                          </form>
                          <form action={voiceVideoRecordingAction}>
                            <input type="hidden" name="roomId" value={room.id} />
                            <input type="hidden" name="action" value="stop" />
                            <Button type="submit" variant="quiet">{t("voiceVideo.stopRecording")}</Button>
                          </form>
                        </>
                      ) : null}
                      <form action={stopVoiceVideoAction}>
                        <input type="hidden" name="roomId" value={room.id} />
                        <Button type="submit" variant="quiet">
                          {t("voiceVideo.stop")}
                        </Button>
                      </form>
                      <form action={missVoiceVideoAction}>
                        <input type="hidden" name="roomId" value={room.id} />
                        <Button type="submit" variant="quiet">
                          {t("voiceVideo.missed")}
                        </Button>
                      </form>
                    </>
                  ) : null}
                  {(room.status === "live" || room.status === "ended") && !recordings.some(item => item.roomId === room.id) ? (
                    <form action={recordVoiceVideoAction}>
                      <input type="hidden" name="roomId" value={room.id} />
                      <input type="hidden" name="contactId" value={room.contactId} />
                      <input type="hidden" name="kind" value={room.kind} />
                      <input type="hidden" name="provider" value={room.provider} />
                      <input type="hidden" name="title" value={room.title} />
                      <Button type="submit" variant="quiet">{t("voiceVideo.checkRecording")}</Button>
                    </form>
                  ) : null}
                  {["failed", "pending", "stopping"].includes(room.status) && (!room.providerLeaseExpiresAt || room.providerLeaseExpiresAt <= new Date()) ? (
                    room.externalRef ? (
                      <form action={stopVoiceVideoAction}>
                        <input type="hidden" name="roomId" value={room.id} />
                        <Button type="submit" variant="quiet">
                          {t("voiceVideo.retry")}
                        </Button>
                      </form>
                    ) : (
                      <form action={startVoiceVideoAction}>
                        <input type="hidden" name="roomId" value={room.id} />
                        <input type="hidden" name="contactId" value={room.contactId} />
                        <input type="hidden" name="kind" value={room.kind} />
                        <input type="hidden" name="provider" value={room.provider} />
                        <input type="hidden" name="title" value={room.title} />
                        <Button type="submit" variant="quiet">
                          {t("voiceVideo.retry")}
                        </Button>
                      </form>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {chosen ? (
        <Card>
          <CardHeader title={chosen.title} />
          <CardBody>
            <p className="text-sm text-ink-muted">
              {t("voiceVideo.joins", { count: (joins ?? []).length })}
            </p>
            {chosen.status === "live" ? (
              <form action={joinVoiceVideoAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="roomId" value={chosen.id} />
                <Field label={t("voiceVideo.field.contact")} htmlFor="vv-join-contact">
                  <Select id="vv-join-contact" name="contactId" required>
                    <option value="">{t("voiceVideo.field.contact")}</option>
                    {(people?.rows ?? []).map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end">
                  <Button type="submit">{t("voiceVideo.join")}</Button>
                </div>
              </form>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("voiceVideo.list")} />
        <CardBody>
          {recordings.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("voiceVideo.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {recordings.map((artifact) => (
                <li key={artifact.id} className="grid gap-2 rounded-md border border-rule p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>{artifact.title}</span>
                    <Pill
                      tone={
                        artifact.status === "recorded"
                          ? "success"
                          : artifact.status === "failed"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {t(`voiceVideo.status.${artifact.status}`)}
                    </Pill>
                    {artifact.lastError ? <span className="text-danger">{artifact.lastError}</span> : null}
                    {["failed", "recorded", "pending"].includes(artifact.status) && (!artifact.providerLeaseExpiresAt || artifact.providerLeaseExpiresAt <= new Date()) ? (
                      <form action={recordVoiceVideoAction}>
                        <input type="hidden" name="artifactId" value={artifact.id} />
                        <input type="hidden" name="refresh" value="true" />
                        <input type="hidden" name="contactId" value={artifact.contactId} />
                        <input type="hidden" name="kind" value={artifact.kind} />
                        <input type="hidden" name="provider" value={artifact.provider} />
                        <input type="hidden" name="title" value={artifact.title} />
                        <input type="hidden" name="roomId" value={artifact.roomId ?? ""} />
                        <Button type="submit" variant="quiet">
                          {t(artifact.status === "recorded" ? "voiceVideo.refreshTranscript" : "voiceVideo.retry")}
                        </Button>
                      </form>
                    ) : null}
                    {artifact.status === "recorded" ? <form action={voiceVideoDownloadAction}><input type="hidden" name="artifactId" value={artifact.id} /><Button type="submit" variant="quiet">{t("voiceVideo.download")}</Button></form> : null}
                    {artifact.importStatus ? (
                      <Pill
                        tone={
                          artifact.importStatus === "imported"
                            ? "success"
                            : artifact.importStatus === "failed"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {t(artifact.importStatus === "imported" ? "voiceVideo.imported" : artifact.importStatus === "failed" ? "voiceVideo.importFailed" : "voiceVideo.importPending")}
                      </Pill>
                    ) : null}
                    {artifact.importError ? <span className="text-danger">{artifact.importError}</span> : null}
                    {artifact.status === "recorded" && artifact.importStatus !== "imported" && (!artifact.providerLeaseExpiresAt || artifact.providerLeaseExpiresAt <= new Date()) ? (
                      <form action={voiceVideoImportAction}>
                        <input type="hidden" name="artifactId" value={artifact.id} />
                        <Button type="submit" variant="quiet">{t("voiceVideo.importRetry")}</Button>
                      </form>
                    ) : null}
                  </div>
                  {artifact.transcript ? (
                    <p className="text-ink-muted">
                      {t("voiceVideo.transcript")}: {artifact.transcript}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
