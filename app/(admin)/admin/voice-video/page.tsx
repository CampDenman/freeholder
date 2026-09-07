// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Voice and video artifacts (MASTER.md §4.14, C3.13).
import type { Metadata } from "next";
import { Button, Card, CardBody, CardHeader, Field, Input, Pill, Select } from "@/ui/primitives";
import { listContacts } from "@/core/contacts/service";
import { listVoiceVideoArtifacts } from "../../../../plugins/voice-video/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import { recordVoiceVideoAction } from "../../first-party-plugin-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function VoiceVideoPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("voiceVideo", "manage");
  const query = await searchParams;
  const [t, artifacts, people] = await Promise.all([
    getT(),
    domainOrNull(listVoiceVideoArtifacts.call({}, actor)),
    domainOrNull(listContacts.call({ limit: 100 }, actor)),
  ]);

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
        <CardHeader title={t("voiceVideo.record")} />
        <CardBody>
          <form action={recordVoiceVideoAction} className="grid gap-3 sm:grid-cols-2">
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
            <Field label={t("voiceVideo.field.provider")} htmlFor="vv-provider">
              <Input id="vv-provider" name="provider" defaultValue="fixture" required />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit">{t("voiceVideo.record")}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("voiceVideo.list")} />
        <CardBody>
          {(artifacts ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t("voiceVideo.empty")}</p>
          ) : (
            <ul className="grid list-none gap-2 p-0">
              {(artifacts ?? []).map((artifact) => (
                <li key={artifact.id} className="flex flex-wrap items-center gap-3 rounded-md border border-rule p-3 text-sm">
                  <span>{artifact.title}</span>
                  <Pill tone={artifact.status === "recorded" ? "success" : artifact.status === "failed" ? "danger" : "neutral"}>
                    {t(`voiceVideo.status.${artifact.status}`)}
                  </Pill>
                  {artifact.lastError ? <span className="text-danger">{artifact.lastError}</span> : null}
                  {artifact.status === "failed" ? (
                    <form action={recordVoiceVideoAction}>
                      <input type="hidden" name="artifactId" value={artifact.id} />
                      <input type="hidden" name="contactId" value={artifact.contactId} />
                      <input type="hidden" name="kind" value={artifact.kind} />
                      <input type="hidden" name="provider" value={artifact.provider} />
                      <input type="hidden" name="title" value={artifact.title} />
                      <Button type="submit" variant="quiet">
                        {t("voiceVideo.retry")}
                      </Button>
                    </form>
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
