// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Sharing, present by default on every public page (MASTER.md §34, C9.28).
//
// §34's first line — "Sharing isn't a buttons plugin; it's a property of every
// entity with a public face" — is why this is rendered by the one public route
// rather than dropped in as a block an owner has to remember to add. A page
// published on Tuesday is shareable on Tuesday.
//
// It is also the first of the four places the entity-level control is
// enforced: an entity an owner has switched off renders nothing here. The
// other three are minting a link, following one, and the social card — and it
// is the *third* that makes the setting mean something, because a control that
// only hides buttons would leave every link already in the world working.
import { getT } from "../i18n";
import { targetFor } from "@/modules/share/service";
import { shareText } from "@/modules/share/intents";
import { shortLinkUrl } from "@/modules/share/links";
import { shareEntityAction } from "./share-actions";
import { NativeShare } from "./NativeShare";

const ANONYMOUS = { kind: "anonymous" } as const;

/** Refs are minted from a fixed alphabet; anything else did not come from us. */
const REF = /^[a-z0-9]{4,32}$/;

export async function ShareBar({
  path,
  locale,
  title,
  siteName,
  sharedRef,
}: {
  path: string;
  locale: string;
  title: string;
  siteName: string | null;
  sharedRef?: string;
}) {
  const t = await getT();
  let target: Awaited<ReturnType<typeof targetFor.call>>;
  try {
    target = await targetFor.call({ path, locale }, ANONYMOUS);
  } catch {
    // A page must never fail to render because its share bar could not decide
    // what to offer. The visitor came to read something.
    return null;
  }
  if (!target.shareable || target.canonicalUrl === null) return null;

  const headline = target.socialTitle ?? title;
  const attribution = shareText(headline, siteName);
  const minted = sharedRef && REF.test(sharedRef) ? sharedRef : null;
  const mintedUrl = minted ? shortLinkUrl(minted) : null;

  return (
    <section
      aria-labelledby="share-bar-title"
      className="mt-8 rounded-lg border border-rule bg-surface-muted p-4"
    >
      <h2 id="share-bar-title" className="text-sm font-semibold text-ink">
        {t("share.public.title")}
      </h2>
      <form action={shareEntityAction} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="title" value={headline} />
        {target.channels.map((channel) => (
          <button
            key={channel}
            type="submit"
            name="channel"
            value={channel}
            className="inline-flex items-center justify-center rounded-md border border-rule bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
          >
            {t(`share.channel.${channel}`)}
          </button>
        ))}
      </form>

      {mintedUrl ? (
        <div className="mt-4 grid gap-2">
          <label htmlFor="share-bar-link" className="text-xs text-ink-muted">
            {t("share.public.copyHint")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="share-bar-link"
              readOnly
              value={`${attribution} ${mintedUrl}`}
              className="min-w-0 flex-1 rounded-md border border-rule bg-field px-3 py-1.5 font-mono text-sm text-ink"
            />
            <NativeShare
              url={mintedUrl}
              text={attribution}
              label={t("share.public.nativeShare")}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
