// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// The asset library (MASTER.md §3 core/media, §4.5).
import { Image as ImageIcon } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/core/i18n";
import { assetUsage, listAssets, resolveImage } from "@/core/media/service";
import { Card, Pill } from "@/ui/primitives";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { UploadForm } from "./UploadForm";
import { AltTextForm } from "./AltTextForm";
import { DeleteAssetButton } from "./DeleteAssetButton";
import { currentBusiness } from "@/core/settings/read";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function MediaPage() {
  const actor = await requireStaffActor();
  const [library, business, t] = await Promise.all([
    listAssets.call({}, actor),
    currentBusiness(),
    getT(),
  ]);

  const timezone = business?.timezone ?? "UTC";
  const locale = business?.defaultLocale ?? "en";
  // Deleting is irreversible, so it is owner-only at the service and hidden
  // from staff here rather than offered and refused.
  const owner = actor.kind === "user" && actor.role === "owner";

  // Where each file is still referenced, so the confirmation can say what will
  // be left with a gap.
  const usage = new Map(
    owner
      ? await Promise.all(
          library.rows.map(
            async (asset) =>
              [asset.id, await assetUsage.call({ id: asset.id }, actor)] as const,
          ),
        )
      : [],
  );

  // Previews come from the same resolver a public page uses, so the library
  // shows what a visitor would actually be served.
  const previews = new Map(
    await Promise.all(
      library.rows
        .filter((asset) => asset.kind === "image")
        .map(
          async (asset) =>
            [
              asset.id,
              await resolveImage.call({ id: asset.id }, ANONYMOUS),
            ] as const,
        ),
    ),
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("media.title")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("media.intro")}</p>
      </div>

      <UploadForm
        labels={{
          file: t("media.file"),
          fileHint: t("media.fileHint"),
          submit: t("media.upload"),
          pending: t("media.uploading"),
          failed: t("media.uploadFailed"),
        }}
      />

      <Card>
        {library.rows.length === 0 ? (
          <div className="grid justify-items-start gap-3 px-4 py-10">
            <ImageIcon size={26} weight="light" className="text-ink-muted" />
            <p className="text-sm text-ink-muted">{t("media.empty")}</p>
          </div>
        ) : (
          <ul className="grid list-none gap-0 p-0">
            {library.rows.map((asset) => {
              const preview = previews.get(asset.id);
              return (
                <li
                  key={asset.id}
                  className="grid gap-3 border-b border-rule px-4 py-4 last:border-b-0 sm:grid-cols-[6rem_1fr]"
                >
                  <div className="flex items-start">
                    {preview ? (
                      <img
                        src={preview.src}
                        alt=""
                        className="h-20 w-24 rounded-md border border-rule object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-24 items-center justify-center rounded-md border border-rule bg-surface-muted">
                        <ImageIcon
                          size={20}
                          weight="light"
                          className="text-ink-muted"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {asset.filename}
                      </span>
                      <Pill tone="neutral">{t(`media.kind.${asset.kind}`)}</Pill>
                      {asset.width ? (
                        <span className="font-mono text-xs text-ink-muted">
                          {asset.width}&times;{asset.height}
                        </span>
                      ) : null}
                      {/* Not a scold for its own sake: §5 fails a page that
                          renders an image with no description, so the debt is
                          shown where it can actually be paid. */}
                      {asset.kind === "image" && !asset.altText ? (
                        <Pill tone="warning">{t("media.needsAlt")}</Pill>
                      ) : null}
                      <time className="ms-auto font-mono text-xs text-ink-muted tabular-nums">
                        {formatDateTime(asset.createdAt, timezone, locale)}
                      </time>
                    </div>

                    {owner ? (
                      <div className="flex justify-end">
                        <DeleteAssetButton
                          id={asset.id}
                          labels={{
                            delete: t("media.delete"),
                            confirm: t("media.deleteConfirm"),
                            cancel: t("common.cancel"),
                            usedOn:
                              (usage.get(asset.id)?.pages ?? 0) +
                                (usage.get(asset.id)?.sections ?? 0) >
                              0
                                ? t("media.stillUsed", {
                                    places:
                                      (usage.get(asset.id)?.pages ?? 0) +
                                      (usage.get(asset.id)?.sections ?? 0),
                                  })
                                : "",
                          }}
                        />
                      </div>
                    ) : null}

                    {asset.kind === "image" ? (
                      <AltTextForm
                        id={asset.id}
                        value={asset.altText ?? ""}
                        labels={{
                          label: t("media.altText"),
                          hint: t("media.altTextHint"),
                          save: t("common.save"),
                        }}
                      />
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
