// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Complete media library: upload, trust state, provenance, crop anchor and
// recoverable lifecycle (MASTER.md C1.12).
import Link from "next/link";
import {
  FileText,
  FilmSlate,
  Image as ImageIcon,
  MusicNotes,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import {
  assetUsage,
  listAssets,
  resolveAsset,
  resolveImage,
} from "@/core/media/service";
import { Card, Callout, Pill, cx } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { UploadForm } from "./UploadForm";
import { AltTextForm } from "./AltTextForm";
import { DeleteAssetButton } from "./DeleteAssetButton";
import { FocalPointForm } from "./FocalPointForm";
import { TrashActions } from "./TrashActions";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess } from "@/core/service";
import {
  rescanAssetAction,
  updateAssetDetailsAction,
} from "../../media-actions";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;
const KINDS = ["image", "video", "audio", "doc"] as const;
type Kind = (typeof KINDS)[number];

function bytes(value: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(amount)} ${units[unit]}`;
}

function statusTone(status: string) {
  if (status === "ready") return "success" as const;
  if (status === "quarantined" || status === "failed") return "danger" as const;
  if (status === "trashed") return "warning" as const;
  return "neutral" as const;
}

function KindIcon({ kind }: { kind: Kind }) {
  const props = { size: 22, weight: "light" as const, className: "text-ink-muted" };
  if (kind === "video") return <FilmSlate {...props} />;
  if (kind === "audio") return <MusicNotes {...props} />;
  if (kind === "doc") return <FileText {...props} />;
  return <ImageIcon {...props} />;
}

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; kind?: string }>;
}) {
  const actor = await requireStaffActor("media");
  const query = await searchParams;
  const trashed = query.view === "trash";
  const kind = KINDS.includes(query.kind as Kind) ? (query.kind as Kind) : undefined;
  const [library, business, t] = await Promise.all([
    listAssets.call(
      trashed
        ? { status: "trashed", kind, limit: 100 }
        : { includeUnavailable: true, kind, limit: 100 },
      actor,
    ),
    currentBusiness(),
    getT(),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  const canManage = hasModuleAccess(actor, "media", "manage");
  const usage = new Map(
    canManage && !trashed
      ? await Promise.all(
          library.rows.map(
            async (asset) =>
              [asset.id, await assetUsage.call({ id: asset.id }, actor)] as const,
          ),
        )
      : [],
  );
  const imagePreviews = new Map(
    await Promise.all(
      library.rows
        .filter((asset) => asset.kind === "image" && asset.status === "ready")
        .map(
          async (asset) =>
            [asset.id, await resolveImage.call({ id: asset.id }, ANONYMOUS)] as const,
        ),
    ),
  );
  const mediaPreviews = new Map(
    await Promise.all(
      library.rows
        .filter((asset) => asset.kind !== "image" && asset.status === "ready")
        .map(
          async (asset) =>
            [asset.id, await resolveAsset.call({ id: asset.id }, ANONYMOUS)] as const,
        ),
    ),
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("media.title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("media.intro")}</p>
        </div>
        <nav aria-label={t("media.views")} className="flex rounded-md border border-rule p-1">
          <Link
            href="/admin/media"
            className={cx(
              "rounded px-3 py-1.5 text-xs font-semibold",
              !trashed ? "bg-accent-soft text-accent" : "text-ink-muted",
            )}
          >
            {t("media.library")}
          </Link>
          <Link
            href="/admin/media?view=trash"
            className={cx(
              "rounded px-3 py-1.5 text-xs font-semibold",
              trashed ? "bg-accent-soft text-accent" : "text-ink-muted",
            )}
          >
            {t("media.trash")}
          </Link>
        </nav>
      </div>

      {!trashed && canManage ? (
        <UploadForm
          labels={{
            file: t("media.file"),
            fileHint: t("media.fileHint"),
            submit: t("media.upload"),
            pending: t("media.uploading"),
            failed: t("media.uploadFailed"),
            progress: t("media.uploadProgress"),
            resumable: t("media.uploadResuming"),
            cancel: t("common.cancel"),
          }}
        />
      ) : null}

      {!trashed ? (
        <nav aria-label={t("media.filter")} className="flex flex-wrap gap-2">
          <Link href="/admin/media" className={cx("rounded-full border px-3 py-1 text-xs", !kind ? "border-accent text-accent" : "border-rule text-ink-muted")}>
            {t("media.kind.all")}
          </Link>
          {KINDS.map((value) => (
            <Link
              key={value}
              href={`/admin/media?kind=${value}`}
              className={cx("rounded-full border px-3 py-1 text-xs", kind === value ? "border-accent text-accent" : "border-rule text-ink-muted")}
            >
              {t(`media.kind.${value}`)}
            </Link>
          ))}
        </nav>
      ) : null}

      <Card>
        {library.rows.length === 0 ? (
          <div className="grid justify-items-start gap-3 px-4 py-10">
            <ImageIcon size={26} weight="light" className="text-ink-muted" />
            <p className="text-sm text-ink-muted">
              {t(trashed ? "media.trashEmpty" : "media.empty")}
            </p>
          </div>
        ) : (
          <ul className="grid list-none gap-0 p-0">
            {library.rows.map((asset) => {
              const image = imagePreviews.get(asset.id);
              const media = mediaPreviews.get(asset.id);
              const metadata = asset.metadata as Record<string, unknown>;
              const provenance = asset.provenance as Record<string, unknown>;
              const places =
                (usage.get(asset.id)?.pages ?? 0) +
                (usage.get(asset.id)?.sections ?? 0);
              return (
                <li
                  key={asset.id}
                  className="grid gap-4 border-b border-rule px-4 py-5 last:border-b-0 md:grid-cols-[10rem_1fr]"
                >
                  <div className="grid content-start gap-2">
                    {image ? (
                      <img
                        src={image.src}
                        alt=""
                        style={{ objectPosition: `${asset.focalX / 100}% ${asset.focalY / 100}%` }}
                        className="h-28 w-40 rounded-md border border-rule object-cover"
                      />
                    ) : media?.kind === "video" ? (
                      <video src={media.src} controls preload="metadata" className="h-28 w-40 rounded-md border border-rule bg-surface-muted object-contain" />
                    ) : media?.kind === "audio" ? (
                      <div className="grid h-28 w-40 place-items-center gap-2 rounded-md border border-rule bg-surface-muted p-2">
                        <MusicNotes size={24} className="text-ink-muted" />
                        <audio src={media.src} controls preload="metadata" className="h-8 w-36" />
                      </div>
                    ) : (
                      <div className="flex h-28 w-40 items-center justify-center rounded-md border border-rule bg-surface-muted">
                        <KindIcon kind={asset.kind} />
                      </div>
                    )}
                    {media?.kind === "doc" ? (
                      <a href={media.src} className="text-xs font-semibold text-accent underline underline-offset-2">
                        {t("media.download")}
                      </a>
                    ) : null}
                  </div>

                  <div className="min-w-0 grid gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all text-sm font-semibold">{asset.filename}</span>
                      <Pill tone="neutral">{t(`media.kind.${asset.kind}`)}</Pill>
                      <Pill tone={statusTone(asset.status)}>{t(`media.status.${asset.status}`)}</Pill>
                      <Pill tone={asset.scanStatus === "infected" || asset.scanStatus === "error" ? "danger" : asset.scanStatus === "clean" ? "success" : "neutral"}>
                        {t(`media.scan.${asset.scanStatus}`)}
                      </Pill>
                      <time className="ms-auto font-mono text-xs text-ink-muted tabular-nums">
                        {formatDateTime(asset.createdAt, timezone, locale)}
                      </time>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-muted">
                      <span>{bytes(asset.bytes, locale)}</span>
                      <span>{asset.mime}</span>
                      {asset.width ? <span>{asset.width}&times;{asset.height}</span> : null}
                      {asset.durationSeconds != null ? <span>{t("media.duration", { seconds: asset.durationSeconds })}</span> : null}
                      {typeof metadata.pageCount === "number" ? <span>{t("media.pages", { pages: metadata.pageCount })}</span> : null}
                      {asset.checksumSha256 ? <span title={asset.checksumSha256}>{t("media.checksum", { digest: asset.checksumSha256.slice(0, 12) })}</span> : null}
                    </div>

                    {asset.scanStatus === "infected" || asset.scanStatus === "error" ? (
                      <Callout tone="danger" icon={<WarningCircle size={16} weight="fill" />}>
                        {asset.scanMessage ?? t("media.quarantineReason")}
                      </Callout>
                    ) : asset.scanStatus === "not_configured" ? (
                      <Callout tone="neutral" icon={<ShieldCheck size={16} />}>
                        {t("media.scannerNotConfigured")}
                      </Callout>
                    ) : null}

                    {canManage && trashed ? (
                      <TrashActions
                        id={asset.id}
                        filename={asset.filename}
                        canPurge={actor.kind === "user" && actor.role === "owner"}
                        needsStepUp={Boolean(
                          actor.kind === "user" &&
                            actor.security &&
                            !actor.security.stepUpValid,
                        )}
                        labels={{
                          restore: t("media.restore"),
                          purge: t("media.purge"),
                          purgeHeading: t("media.purgeHeading"),
                          purgeHint: t("media.purgeHint"),
                          confirmation: t("media.purgeConfirmation"),
                          cancel: t("common.cancel"),
                          verify: t("security.verifyFirst"),
                        }}
                      />
                    ) : null}

                    {canManage && !trashed ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {asset.scanStatus !== "clean" ? (
                          <form action={rescanAssetAction}>
                            <input type="hidden" name="id" value={asset.id} />
                            <button type="submit" className="text-xs font-semibold text-accent underline underline-offset-2">
                              {t("media.rescan")}
                            </button>
                          </form>
                        ) : null}
                        <DeleteAssetButton
                          id={asset.id}
                          labels={{
                            delete: t("media.delete"),
                            confirm: t("media.deleteConfirm"),
                            cancel: t("common.cancel"),
                            usedOn: places > 0 ? t("media.stillUsed", { places }) : "",
                          }}
                        />
                      </div>
                    ) : null}

                    {canManage && asset.kind === "image" && !trashed ? (
                      <div className="grid gap-4 border-t border-rule pt-3 lg:grid-cols-2">
                        <AltTextForm
                          id={asset.id}
                          value={asset.altText ?? ""}
                          labels={{
                            label: t("media.altText"),
                            hint: t("media.altTextHint"),
                            save: t("common.save"),
                          }}
                        />
                        <FocalPointForm
                          id={asset.id}
                          initialX={asset.focalX}
                          initialY={asset.focalY}
                          labels={{
                            heading: t("media.focalPoint"),
                            x: t("media.focalHorizontal"),
                            y: t("media.focalVertical"),
                            save: t("common.save"),
                          }}
                        />
                      </div>
                    ) : null}

                    {canManage && !trashed ? (
                      <details className="border-t border-rule pt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-ink-muted">
                          {t("media.details")}
                        </summary>
                        <form action={updateAssetDetailsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                          <input type="hidden" name="id" value={asset.id} />
                          <label className="grid gap-1 text-xs text-ink-muted">
                            {t("media.codec")}
                            <input name="codec" defaultValue={typeof metadata.codec === "string" ? metadata.codec : ""} className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink" />
                          </label>
                          <label className="grid gap-1 text-xs text-ink-muted">
                            {t("media.durationSeconds")}
                            <input name="durationSeconds" type="number" min={0} defaultValue={asset.durationSeconds ?? ""} className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink" />
                          </label>
                          <label className="grid gap-1 text-xs text-ink-muted">
                            {t("media.pageCount")}
                            <input name="pageCount" type="number" min={1} defaultValue={typeof metadata.pageCount === "number" ? metadata.pageCount : ""} className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink" />
                          </label>
                          <label className="grid gap-1 text-xs text-ink-muted">
                            {t("media.sourceUrl")}
                            <input name="sourceUrl" type="url" defaultValue={typeof provenance.sourceUrl === "string" ? provenance.sourceUrl : ""} className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink" />
                          </label>
                          <label className="grid gap-1 text-xs text-ink-muted">
                            {t("media.capturedAt")}
                            <input name="capturedAt" type="datetime-local" className="rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink" />
                          </label>
                          <label className="grid gap-1 text-xs text-ink-muted sm:col-span-2">
                            {t("media.provenanceNote")}
                            <textarea name="note" maxLength={500} defaultValue={typeof provenance.note === "string" ? provenance.note : ""} className="min-h-20 rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink" />
                          </label>
                          <div className="sm:col-span-2">
                            <button type="submit" className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-on-accent">
                              {t("common.save")}
                            </button>
                          </div>
                        </form>
                      </details>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
