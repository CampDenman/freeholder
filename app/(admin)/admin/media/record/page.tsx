// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Screen, camera and microphone capture plus phone ingest (C1.28, C1.29).

import { getCaptureSession, listCaptureSessions } from "@/core/media/capture";
import { Button, Card, CardBody, CardHeader } from "@/ui/primitives";
import { getT } from "../../../../i18n";
import { requireStaffActor } from "../../guard";
import {
  createPhoneLinkAction,
  startRecordingAction,
} from "../../../capture-actions";
import { RecordStudio } from "../RecordStudio";

export const dynamic = "force-dynamic";

export default async function MediaRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; link?: string }>;
}) {
  const actor = await requireStaffActor("media", "manage");
  const query = await searchParams;
  const [sessions, t, current, link] = await Promise.all([
    listCaptureSessions.call({}, actor),
    getT(),
    query.session ? getCaptureSession.call({ id: query.session }, actor) : null,
    query.link ? getCaptureSession.call({ id: query.link }, actor) : null,
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <a href="/admin/media" className="text-sm text-ink-muted">{t("media.capture.back")}</a>
        <h1 className="mt-2 text-xl font-bold tracking-tight">{t("media.capture.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("media.capture.intro")}</p>
      </div>

      <Card>
        <CardHeader title={t("media.capture.start")} />
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {(["screen", "camera", "microphone"] as const).map((source) => (
              <form key={source} action={startRecordingAction}>
                <input type="hidden" name="source" value={source} />
                <Button type="submit">{t(`media.capture.source.${source}`)}</Button>
              </form>
            ))}
            <form action={createPhoneLinkAction}>
              <Button type="submit">{t("media.capture.phoneLink")}</Button>
            </form>
          </div>
        </CardBody>
      </Card>

      {current ? (
        <RecordStudio
          session={current}
          labels={{
            title: t(`media.capture.source.${current.source}`),
            grant: t("media.capture.grant"),
            record: t("media.capture.record"),
            stop: t("media.capture.stop"),
            live: t("media.capture.live"),
            caption: t("media.capture.caption"),
            trimStart: t("media.capture.trimStart"),
            trimEnd: t("media.capture.trimEnd"),
            cropX: t("media.capture.cropX"),
            cropY: t("media.capture.cropY"),
            saveReview: t("media.capture.saveReview"),
            confirm: t("media.capture.confirm"),
            discard: t("media.capture.discard"),
          }}
        />
      ) : null}

      {link?.captureUrl ? (
        <Card>
          <CardHeader title={t("media.capture.phoneLink")} />
          <CardBody>
            <p className="text-sm text-ink-muted">{t("media.capture.phoneHint")}</p>
            <p className="mt-2 break-all font-mono text-sm">{link.captureUrl}</p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("media.capture.recent")} />
        <CardBody>
          <ul className="grid list-none gap-2 p-0 text-sm">
            {sessions.length === 0 ? <li className="text-ink-muted">{t("media.capture.empty")}</li> : null}
            {sessions.slice(0, 12).map((session) => (
              <li key={session.id}>
                <a href={`/admin/media/record?session=${session.id}`} className="font-semibold text-ink">
                  {t(`media.capture.source.${session.source}`)}
                </a>
                <span className="text-ink-muted"> · {t(`media.capture.status.${session.status}`)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
