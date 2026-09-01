// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The ad slot, on the page (MASTER.md §4.16, §32, C9.18).
//
// §4.16: an ad position is "placed on the page as a block (§32), so where an
// ad appears is content structure like everything else." The block therefore
// carries one thing — the slot's code — and everything else about the
// placement (which sizes, at which breakpoint, whether unsold space falls back
// to a house promotion) lives on the slot, where changing it is one row rather
// than every page the slot is on.
//
// The block moved here from `cms/blocks/surfaces.tsx` in C9.18. Its C9.17
// shape carried its own house image, its own href and its own four size
// numbers, which was a second, private notion of an ad living inside the page
// tree: unlabelled, uncounted, unreviewed, and invisible to the campaign
// screen the owner sells from. §4.16 forbids exactly that — "sponsored
// placements are labelled in the markup … and there is no configuration that
// removes the label" — so a house promotion is now a campaign like any other,
// and this renders whatever `ads.serve` says is running.
//
// ── Why the server answers for every breakpoint ───────────────────────────
//
// §4.16 wants "one placement [to serve] a leaderboard on a laptop and a 320×50
// on a phone without the owner building two pages", and the platform refuses
// to derive anything from a visitor's device (`analytics/visitor.ts` is
// explicit about it). So `ads.serve` answers once per breakpoint the slot
// declares, all the answers go into the HTML, and CSS shows the one that
// belongs. Nothing is sniffed, nothing arrives late, and the space is right
// before a byte of JavaScript runs — which is the Core Web Vitals promise §36
// makes on core's behalf.
//
// Counting the impression of the copy that is actually visible is C9.19: an
// element hidden by a media query is never 50% viewable for a second, so the
// MRC definition already does the disambiguation for us.
import { z } from "zod";
import { defineBlock } from "@/modules/cms/blocks/types";
import type { ResolvedImage } from "@/core/media/service";

const ANONYMOUS = { kind: "anonymous" } as const;

type Breakpoint = "desktop" | "tablet" | "mobile";

interface ServedFill {
  breakpoint: Breakpoint;
  width: number;
  height: number;
  creative: {
    id: string;
    kind: "image" | "native";
    assetId: string | null;
    altText: string | null;
    headline: string | null;
    body: string | null;
    ctaLabel: string | null;
    href: string;
    label: "sponsored" | "house";
  } | null;
}

interface Served {
  lazy: boolean;
  fills: Array<ServedFill & { image: ResolvedImage | null }>;
}

/** Narrow to wide, which is the order the visibility rules are built in. */
const ORDER: Breakpoint[] = ["mobile", "tablet", "desktop"];

/** Tailwind's breakpoints, as the min-width each of ours starts at. */
const PREFIX: Record<Breakpoint, string | null> = {
  mobile: null,
  tablet: "md",
  desktop: "lg",
};

/**
 * Show each answer over exactly the widths it was chosen for.
 *
 * Derived from the breakpoints the slot actually declares rather than
 * hardcoded, because most slots declare two. A slot with a desktop and a
 * mobile format and nothing in between must not go blank on a tablet: the
 * mobile answer runs until the desktop one starts.
 */
function visibility(breakpoint: Breakpoint, declared: Breakpoint[]): string {
  const present = ORDER.filter((each) => declared.includes(each));
  const index = present.indexOf(breakpoint);
  const from = PREFIX[breakpoint];
  const next = present[index + 1];
  const until = next ? PREFIX[next] : null;
  return [from ? `hidden ${from}:block` : "block", until ? `${until}:hidden` : ""]
    .filter(Boolean)
    .join(" ");
}

export const adSlot = defineBlock({
  type: "adSlot",
  labelKey: "cms.block.adSlot",
  contexts: ["page", "chrome"],
  // One field, because everything else is a property of the slot. An owner
  // who wants a different size here is describing a different position.
  schema: z.object({ code: z.string().trim().min(1).max(40) }),
  starter: () => ({ code: "header" }),
  resolve: async (props, ctx): Promise<Served | null> => {
    const { serve } = await import("./service");
    const served = await serve.call(
      { code: props.code, path: ctx.path, locale: ctx.locale },
      ANONYMOUS,
    );
    if (!served) return null;

    // Dynamically imported so the block does not drag core/media into every
    // bundle that only needed a heading — the same reason the image block does.
    const { resolveImage } = await import("@/core/media/service");
    const fills = await Promise.all(
      served.fills.map(async (fill) => ({
        ...fill,
        image: fill.creative?.assetId
          ? await resolveImage.call({ id: fill.creative.assetId }, ANONYMOUS)
          : null,
      })),
    );
    return { lazy: served.lazy, fills };
  },
  render: ({ resolved, ctx }) => {
    // Nothing sold and no house promotion: render nothing at all. The reason
    // §4.16 reserves space is that "an ad that arrives late and pushes the
    // article down is a Core Web Vitals failure" — and nothing arrives late
    // here, because the answer is in the server's HTML. An empty grey box on
    // every page of an unsold site would be a cost paid for no benefit.
    const filled = (resolved?.fills ?? []).filter((fill) => fill.creative !== null);
    if (!resolved || filled.length === 0) return null;
    const declared = filled.map((fill) => fill.breakpoint);

    return (
      <aside aria-label={ctx.t("ads.label.region")} className="grid justify-items-center">
        {filled.map((fill) => {
          const creative = fill.creative!;
          return (
            <div key={fill.breakpoint} className={visibility(fill.breakpoint, declared)}>
              {/* The label, unconditionally. §4.16: "there is no configuration
                  that removes the label", so there is no prop here to remove
                  it with and no branch that omits it. */}
              <p className="text-xs uppercase tracking-wide text-ink-muted">
                {ctx.t(`ads.label.${creative.label}`)}
              </p>
              <a
                href={creative.href}
                // `sponsored` is the declaration §4.16 asks for; `nofollow`
                // because a paid link must not pass ranking either way; and
                // `noopener` because the destination is somebody else's site.
                rel="sponsored nofollow noopener"
                className="grid place-items-center overflow-hidden rounded-md border border-rule bg-surface"
                // The declared size, so an oversized file cannot change the
                // shape of the page it was sold into.
                style={{ width: fill.width, height: fill.height }}
              >
                {creative.kind === "image" && fill.image ? (
                  <picture>
                    {fill.image.sources.map((source) => (
                      <source key={source.format} srcSet={source.srcset} type={source.type} />
                    ))}
                    <img
                      src={fill.image.src}
                      alt={creative.altText ?? fill.image.altText ?? ""}
                      width={fill.width}
                      height={fill.height}
                      loading={resolved.lazy ? "lazy" : "eager"}
                      decoding="async"
                      className="h-full w-full object-contain"
                    />
                  </picture>
                ) : (
                  <span className="grid gap-1 px-3 py-2 text-center">
                    <span className="text-sm font-semibold text-ink">{creative.headline}</span>
                    {creative.body ? (
                      <span className="text-xs text-ink-muted">{creative.body}</span>
                    ) : null}
                    {creative.ctaLabel ? (
                      <span className="text-xs font-semibold text-accent">
                        {creative.ctaLabel}
                      </span>
                    ) : null}
                  </span>
                )}
              </a>
            </div>
          );
        })}
      </aside>
    );
  },
});

export default [adSlot];
