// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sharing: what may be shared, how it looks, and what the links did
// (C9.28, MASTER.md §34).
//
// The list is built from the SEO entity registry rather than from this
// module's own table, and that is the screen's one structural decision. §34
// makes sharing "a property of every entity with a public face", so the list
// of things an owner can control has to be the list of things the site
// publishes — the same list the sitemap and the OG route read. A table of
// share targets would have shown only the pages somebody had already touched,
// which is the opposite of "present by default".
//
// Stored rows still appear even when the registry no longer names their path:
// a page that has been unpublished but whose sharing was switched off should
// not quietly forget that decision, because unpublishing is reversible.
import type { Metadata } from "next";
import {
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pill,
} from "@/ui/primitives";
import { collectPublicEntities } from "@/core/seo/entities";
import { currentBusiness } from "@/core/settings/read";
import { SHARE_CHANNELS } from "@/modules/share/intents";
import { linkReport, targets } from "@/modules/share/service";
import { getT } from "../../../i18n";
import { requireStaffActor } from "../guard";
import { domainOrNull } from "../../read-helpers";
import {
  forgetShareTargetAction,
  saveShareTargetAction,
  setShareableAction,
} from "../../share-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Listed = {
  id: string | null;
  path: string;
  locale: string;
  entityKind: string;
  shareable: boolean;
  channels: string[] | null;
  socialTitle: string | null;
  socialDescription: string | null;
  imageUrl: string | null;
  shares: number;
  published: boolean;
};

export default async function SharingPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("share", "manage");
  const query = await searchParams;
  const business = await currentBusiness();
  const locale = business?.defaultLocale ?? "en";

  const [t, stored, links, entities] = await Promise.all([
    getT(),
    domainOrNull(targets.call({}, actor)),
    domainOrNull(linkReport.call({ days: 90, limit: 100 }, actor)),
    collectPublicEntities(locale).catch(() => []),
  ]);

  const byPath = new Map((stored ?? []).map((each) => [each.path, each]));
  const rows: Listed[] = entities.map((entity) => {
    const saved = byPath.get(entity.slug);
    byPath.delete(entity.slug);
    return {
      id: saved?.id ?? null,
      path: entity.slug,
      locale: saved?.locale ?? locale,
      entityKind: saved?.entityKind ?? entity.kind,
      shareable: saved?.shareable ?? true,
      channels: saved?.channels ?? null,
      socialTitle: saved?.socialTitle ?? null,
      socialDescription: saved?.socialDescription ?? null,
      imageUrl: saved?.imageUrl ?? null,
      shares: saved?.shares ?? 0,
      published: true,
    };
  });
  for (const orphan of byPath.values()) {
    rows.push({ ...orphan, published: false });
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));

  const open = query.path !== undefined
    ? (rows.find((each) => each.path === query.path) ?? {
        id: null,
        path: query.path,
        locale,
        entityKind: "page",
        shareable: true,
        channels: null,
        socialTitle: null,
        socialDescription: null,
        imageUrl: null,
        shares: 0,
        published: false,
      })
    : null;

  const label = (path: string) => (path === "" ? "/" : `/${path}`);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t("share.title")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("share.intro")}</p>
      </div>

      {query.saved ? (
        <p className="rounded-md border border-success bg-success-soft px-3 py-2 text-sm text-success">
          {t("share.saved")}
        </p>
      ) : null}
      {query.error ? (
        <Callout tone="danger">{query.error}</Callout>
      ) : null}

      <Card>
        <CardHeader title={t("share.entities")} />
        <CardBody>
          <p className="mb-3 max-w-prose text-sm text-ink-muted">
            {t("share.entitiesIntro")}
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("share.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead className="text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.path")}</th>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.kind")}</th>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.state")}</th>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.shares")}</th>
                    <th scope="col" className="py-2 text-start">{t("share.column.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={`${entry.path}:${entry.locale}`} className="border-t border-rule">
                      <td className="py-2 pe-3 font-mono text-xs">{label(entry.path)}</td>
                      <td className="py-2 pe-3 text-ink-muted">{entry.entityKind}</td>
                      <td className="py-2 pe-3">
                        <Pill tone={entry.shareable ? "success" : "warning"}>
                          {t(entry.shareable ? "share.state.on" : "share.state.off")}
                        </Pill>
                      </td>
                      <td className="py-2 pe-3 font-mono text-xs">{entry.shares}</td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={setShareableAction}>
                            <input type="hidden" name="path" value={entry.path} />
                            <input type="hidden" name="locale" value={entry.locale} />
                            <input type="hidden" name="entityKind" value={entry.entityKind} />
                            <input type="hidden" name="shareable" value={entry.shareable ? "0" : "1"} />
                            <input type="hidden" name="socialTitle" value={entry.socialTitle ?? ""} />
                            <input
                              type="hidden"
                              name="socialDescription"
                              value={entry.socialDescription ?? ""}
                            />
                            <input type="hidden" name="imageUrl" value={entry.imageUrl ?? ""} />
                            {(entry.channels ?? SHARE_CHANNELS).map((channel) => (
                              <input key={channel} type="hidden" name="channel" value={channel} />
                            ))}
                            <Button variant="quiet" type="submit">
                              {t(entry.shareable ? "share.action.turnOff" : "share.action.turnOn")}
                            </Button>
                          </form>
                          <a
                            href={`/admin/sharing?path=${encodeURIComponent(entry.path)}`}
                            className="text-sm text-ink-muted underline hover:text-ink"
                          >
                            {t("share.action.edit")}
                          </a>
                          {entry.id && !entry.published ? (
                            <form action={forgetShareTargetAction} className="grid gap-1">
                              <input type="hidden" name="id" value={entry.id} />
                              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                                <input
                                  type="checkbox"
                                  name="confirm"
                                  required
                                  className="size-4 accent-accent"
                                />
                                {t("share.action.confirmForget")}
                              </label>
                              <Button variant="quiet" type="submit">
                                {t("share.action.forget")}
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {open ? (
        <Card>
          <CardHeader title={`${t("share.card.title")} — ${label(open.path)}`} />
          <CardBody>
            <form action={saveShareTargetAction} className="grid gap-4">
              <input type="hidden" name="path" value={open.path} />
              <input type="hidden" name="locale" value={open.locale} />
              <input type="hidden" name="entityKind" value={open.entityKind} />

              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="shareable"
                  defaultChecked={open.shareable}
                  className="size-4 accent-accent"
                />
                {t("share.field.shareable")}
              </label>
              <p className="-mt-2 max-w-prose text-xs text-ink-muted">
                {t("share.field.shareableHint")}
              </p>

              <Field
                label={t("share.field.socialTitle")}
                htmlFor="socialTitle"
                hint={t("share.field.socialTitleHint")}
              >
                <Input
                  id="socialTitle"
                  name="socialTitle"
                  maxLength={200}
                  defaultValue={open.socialTitle ?? ""}
                />
              </Field>
              <Field
                label={t("share.field.socialDescription")}
                htmlFor="socialDescription"
              >
                <Input
                  id="socialDescription"
                  name="socialDescription"
                  maxLength={400}
                  defaultValue={open.socialDescription ?? ""}
                />
              </Field>
              <Field
                label={t("share.field.imageUrl")}
                htmlFor="imageUrl"
                hint={t("share.field.imageUrlHint")}
              >
                <Input
                  id="imageUrl"
                  name="imageUrl"
                  maxLength={600}
                  defaultValue={open.imageUrl ?? ""}
                />
              </Field>

              <fieldset className="grid gap-2">
                <legend className="font-mono text-xs font-medium text-ink-muted">
                  {t("share.field.channels")}
                </legend>
                <p className="max-w-prose text-xs text-ink-muted">
                  {t("share.field.channelsHint")}
                </p>
                <div className="flex flex-wrap gap-3">
                  {SHARE_CHANNELS.map((channel) => (
                    <label key={channel} className="flex items-center gap-1.5 text-sm text-ink">
                      <input
                        type="checkbox"
                        name="channel"
                        value={channel}
                        defaultChecked={
                          open.channels === null || open.channels.includes(channel)
                        }
                        className="size-4 accent-accent"
                      />
                      {t(`share.channel.${channel}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <Button type="submit">{t("share.action.save")}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={t("share.links.title")} />
        <CardBody>
          <p className="mb-3 max-w-prose text-sm text-ink-muted">
            {t("share.links.intro")}
          </p>
          <Callout tone="neutral">{t("share.counted")}</Callout>
          {(links ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">{t("share.links.empty")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead className="text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.link")}</th>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.path")}</th>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.channel")}</th>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.sharer")}</th>
                    <th scope="col" className="py-2 pe-3 text-start">{t("share.column.visitors")}</th>
                    <th scope="col" className="py-2 text-start">{t("share.column.conversions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(links ?? []).map((link) => (
                    <tr key={link.id} className="border-t border-rule">
                      <td className="py-2 pe-3 font-mono text-xs">
                        <a href={link.url} className="underline">
                          /s/{link.ref}
                        </a>
                        {link.shareable ? null : (
                          <span className="ms-2">
                            <Pill tone="warning">{t("share.state.off")}</Pill>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pe-3 font-mono text-xs">{label(link.path)}</td>
                      <td className="py-2 pe-3">{t(`share.channel.${link.channel}`)}</td>
                      <td className="py-2 pe-3 text-ink-muted">
                        {link.sharerName ?? t("share.links.anonymous")}
                      </td>
                      <td className="py-2 pe-3 font-mono text-xs">{link.visitors}</td>
                      <td className="py-2 font-mono text-xs">{link.conversions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
