// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The link-in-bio block (MASTER.md §32, C9.39).
//
// One typed block that draws the whole profile: a picture, the business's
// name as the page heading, a short bio, an ordered list of buttons and a row
// of social icons. It lives on an ordinary CMS page, so the page's address,
// title, description, social card, canonical tag, translations and publish
// flow are the ones every page has — this file only draws.
//
// Three decisions worth knowing:
//
//   - **The list is decided at request time.** The public route renders on
//     every request, so an entry scheduled for nine o'clock appears at nine
//     without a publish, and one that expired at midnight is gone at
//     midnight. Hidden, half-written and expired entries never reach the
//     HTML at all.
//   - **Smart entries follow what they point at.** A product, event, page or
//     newsletter entry is kept only while its page is published; a gallery
//     only while it exists and has not expired; a booking only while the
//     service is bookable. A visitor never taps through to a dead end.
//   - **Colour is tokens, and only pairings the token tests guarantee.**
//     `onAccent on accent` for solid buttons, `ink` on `surface` and
//     `surfaceMuted` for the other two styles, `ruleStrong` for every button
//     edge. That is what makes WCAG AA hold in light and dark for any brand
//     an owner saves — the design service refuses a palette that breaks them.
import type { ComponentType } from "react";
import {
  ArrowUpRight,
  Butterfly,
  CalendarCheck,
  EnvelopeSimple,
  FacebookLogo,
  FileText,
  GithubLogo,
  Globe,
  Images,
  InstagramLogo,
  LinkedinLogo,
  MastodonLogo,
  Newspaper,
  PinterestLogo,
  ShoppingBag,
  SoundcloudLogo,
  SpotifyLogo,
  TelegramLogo,
  ThreadsLogo,
  Ticket,
  TiktokLogo,
  TwitchLogo,
  WhatsappLogo,
  XLogo,
  YoutubeLogo,
} from "@phosphor-icons/react/dist/ssr";
import { defineBlock } from "@/modules/cms/blocks/types";
import { getService } from "@/core/service";
import {
  clickHref,
  destinationOf,
  LINK_IN_BIO_BLOCK,
  linkInBioPropsSchema,
  monogram,
  socialHref,
  type LinkInBioProps,
  type LinkKind,
  type LinkStyle,
  type SocialNetwork,
} from "./links";
import { availableLinks } from "./availability";

const ANONYMOUS = { kind: "anonymous" } as const;

type IconProps = { size?: number; weight?: "regular" | "bold" | "fill"; "aria-hidden"?: boolean; className?: string };

const KIND_ICONS: Record<LinkKind, ComponentType<IconProps>> = {
  url: ArrowUpRight,
  page: FileText,
  product: ShoppingBag,
  booking: CalendarCheck,
  newsletter: Newspaper,
  event: Ticket,
  gallery: Images,
};

const SOCIAL_ICONS: Record<SocialNetwork, ComponentType<IconProps>> = {
  instagram: InstagramLogo,
  tiktok: TiktokLogo,
  youtube: YoutubeLogo,
  facebook: FacebookLogo,
  x: XLogo,
  threads: ThreadsLogo,
  bluesky: Butterfly,
  mastodon: MastodonLogo,
  linkedin: LinkedinLogo,
  pinterest: PinterestLogo,
  spotify: SpotifyLogo,
  soundcloud: SoundcloudLogo,
  twitch: TwitchLogo,
  github: GithubLogo,
  whatsapp: WhatsappLogo,
  telegram: TelegramLogo,
  email: EnvelopeSimple,
  website: Globe,
};

/**
 * Every pairing here is one `tests/core/tokens.test.ts` and the design
 * service's `contrastFailures` require of every palette, in both schemes.
 * Motion is opt-in (`motion-safe`) so reduced-motion visitors get none.
 */
const BUTTON_STYLES: Record<LinkStyle, string> = {
  solid: "border border-accent bg-accent text-on-accent hover:shadow-raised",
  outline: "border-2 border-rule-strong bg-surface text-ink hover:border-accent",
  soft: "border border-rule-strong bg-surface-muted text-ink hover:border-accent",
};

interface ShownLink {
  id: string;
  label: string;
  kind: LinkKind;
  external: boolean;
}

interface Resolved {
  links: ShownLink[];
  avatar: { src: string; width: number | null; height: number | null } | null;
}

async function businessZone(): Promise<string> {
  try {
    const { getBusiness } = await import("@/core/settings/service");
    const business = await getBusiness.call({}, ANONYMOUS);
    return business?.timezone ?? "UTC";
  } catch {
    return "UTC";
  }
}

async function avatarFor(props: LinkInBioProps): Promise<Resolved["avatar"]> {
  try {
    const { resolveImage } = await import("@/core/media/service");
    let assetId = props.avatarAssetId.trim();
    if (!assetId) {
      const { getDesign } = await import("@/core/design/service");
      assetId = (await getDesign.call({}, ANONYMOUS)).logoAssetId ?? "";
    }
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
    const image = await resolveImage.call({ id: assetId }, ANONYMOUS);
    return image ? { src: image.src, width: image.width ?? null, height: image.height ?? null } : null;
  } catch {
    // A picture that cannot be found costs the picture, not the page.
    return null;
  }
}

export const linkInBio = defineBlock<typeof linkInBioPropsSchema, Resolved>({
  type: LINK_IN_BIO_BLOCK,
  labelKey: "cms.block.linkInBio",
  contexts: ["page"],
  schema: linkInBioPropsSchema,
  starter: () => ({
    name: "",
    bio: "",
    links: [],
    socials: [],
  }),
  fieldHints: {
    bio: { control: "multiline" },
    avatarAssetId: { control: "asset", assetKind: "image" },
    links: {
      items: {
        id: { hidden: true },
        startsAt: { control: "datetime" },
        endsAt: { control: "datetime" },
      },
    },
  },
  resolve: async (props) => {
    const [timezone, avatar] = await Promise.all([businessZone(), avatarFor(props)]);
    const { shown } = await availableLinks(props.links, timezone, (name, input) =>
      getService(name).call(input, ANONYMOUS),
    );
    return {
      avatar,
      links: shown.map((link) => ({
        id: link.id,
        label: link.label.trim(),
        kind: link.kind,
        external: destinationOf(link)?.external ?? false,
      })),
    };
  },
  render: ({ props, ctx, resolved }) => {
    const name = props.name.trim() || ctx.business?.name || ctx.t("common.appName");
    const Heading = props.headingLevel === 1 ? "h1" : "h2";
    const locale =
      ctx.business?.defaultLocale && ctx.locale !== ctx.business.defaultLocale ? ctx.locale : undefined;
    const socials = props.socials
      .map((item) => ({ ...item, href: socialHref(item) }))
      .filter((item): item is typeof item & { href: string } => item.href !== null);
    return (
      <div className="mx-auto grid w-full max-w-md justify-items-center gap-4 text-center">
        {resolved.avatar ? (
          <img
            src={resolved.avatar.src}
            // The name is the next thing read; announcing the picture as
            // well would say the business's name twice.
            alt=""
            width={96}
            height={96}
            decoding="async"
            className="h-24 w-24 rounded-full border border-rule object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid h-24 w-24 place-items-center rounded-full bg-accent text-2xl font-bold text-on-accent"
          >
            {monogram(name)}
          </span>
        )}
        <Heading className="text-2xl font-bold tracking-tight text-ink" {...ctx.editable?.("name")}>
          {name}
        </Heading>
        {props.bio.trim() ? (
          <p className="max-w-prose whitespace-pre-line text-ink-muted" {...ctx.editable?.("bio")}>
            {props.bio.trim()}
          </p>
        ) : null}
        {resolved.links.length > 0 ? (
          <nav aria-label={ctx.t("linkinbio.public.links")} className="w-full">
            <ul className="grid w-full list-none gap-3 p-0">
              {resolved.links.map((link) => {
                const Icon = KIND_ICONS[link.kind];
                return (
                  <li key={link.id}>
                    <a
                      href={clickHref(link.id, ctx.path, locale)}
                      // The redirect is ours; the destination is somebody
                      // else's when the entry is external.
                      rel={link.external ? "noopener" : undefined}
                      className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-md px-5 py-3 text-base font-semibold motion-safe:transition ${BUTTON_STYLES[props.style]}`}
                    >
                      <Icon size={18} weight="bold" aria-hidden className="shrink-0" />
                      <span>{link.label}</span>
                      {link.external ? (
                        <span className="sr-only">{ctx.t("linkinbio.public.external")}</span>
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
        {socials.length > 0 ? (
          <ul
            aria-label={ctx.t("linkinbio.public.socials")}
            className="flex list-none flex-wrap justify-center gap-1 p-0"
          >
            {socials.map((item) => {
              const Icon = SOCIAL_ICONS[item.network];
              return (
                <li key={`${item.network}-${item.href}`}>
                  {/*
                    Straight to the profile, not through the click counter:
                    `rel="me"` identity checks (Mastodon, Bluesky, search
                    engines' sameAs) compare this exact href.
                  */}
                  <a
                    href={item.href}
                    rel="me noopener"
                    aria-label={ctx.t(`linkinbio.network.${item.network}`)}
                    className="grid h-11 w-11 place-items-center rounded-full text-ink hover:text-accent"
                  >
                    <Icon size={24} aria-hidden />
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    );
  },
  jsonLd: (props) => {
    const sameAs = props.socials
      .map((item) => socialHref(item))
      .filter((href): href is string => href !== null && href.startsWith("http"));
    if (sameAs.length === 0) return undefined;
    // §5: the profile a link-in-bio page *is*, with the profiles it vouches
    // for. The business name comes from the page's own Organization data
    // when the block leaves it blank, so it is added only when written here.
    return {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      mainEntity: {
        "@type": "Organization",
        ...(props.name.trim() ? { name: props.name.trim() } : {}),
        sameAs,
      },
    };
  },
});

export default [linkInBio];

