// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Placeholder home. Replaced by the cms module's block renderer (§7 step 6);
// until then it proves the SSR pipeline — complete HTML, no client JS needed —
// and tells an unconfigured instance what to do next.
import { ArrowRight, Storefront } from "@phosphor-icons/react/dist/ssr";
import { getBusiness, setupState } from "@/core/settings/service";

export const dynamic = "force-dynamic";

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function Home() {
  const state = await setupState.call({}, ANONYMOUS);
  const business = state.hasBusiness
    ? await getBusiness.call({}, ANONYMOUS)
    : null;

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-5 px-6">
      <div className="flex items-center gap-2.5">
        <Storefront size={22} weight="bold" className="text-accent" />
        <span className="font-mono text-xs tracking-wide text-ink-muted">
          Freeholder
        </span>
      </div>

      {business ? (
        <>
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            {business.name}
          </h1>
          {business.tagline ? (
            <p className="max-w-prose text-ink-muted">{business.tagline}</p>
          ) : null}
          <p className="max-w-prose text-sm text-ink-muted">
            The public site arrives with the cms module. Until then, this page
            confirms the platform is serving your business.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            This instance is ready to set up
          </h1>
          <p className="max-w-prose text-ink-muted">
            Create the owner account and tell Freeholder about the business. It
            takes about a minute, and nothing is permanent except who owns the
            site.
          </p>
          <div>
            <a
              href="/setup"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)]"
            >
              Start setup
              <ArrowRight size={15} weight="bold" />
            </a>
          </div>
        </>
      )}
    </main>
  );
}
