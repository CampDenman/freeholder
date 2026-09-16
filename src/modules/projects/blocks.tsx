// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The immutable public snapshot of one case study (MASTER.md C8.01).
//
// The block stores the facts copied at publish time. It does not query the
// project row while rendering: an owner can therefore edit the next draft
// without changing what customers see before they explicitly publish again.
import { z } from "zod";
import { defineBlock } from "@/modules/cms/blocks/types";

const imageRole = z.enum(["hero", "gallery", "before", "after", "process", "detail"]);
const portfolioProject = z.object({
  id: z.string().uuid(),
  title: z.string().max(200),
  slug: z.string().max(120),
  href: z.string().max(300),
  summary: z.string().max(5_000).nullable(),
  coverAssetId: z.string().uuid().nullable(),
  occurredOn: z.string().date().nullable(),
  featured: z.boolean(),
  serviceProductIds: z.array(z.string().uuid()),
});

export const projectCaseStudy = defineBlock({
  type: "projectCaseStudy",
  labelKey: "cms.block.projectCaseStudy",
  contexts: ["page"],
  schema: z.object({
    projectId: z.string().uuid(),
    summary: z.string().max(5_000).nullable().default(null),
    clientDisplayName: z.string().max(200).nullable().default(null),
    occurredOn: z.string().date().nullable().default(null),
    coverAssetId: z.string().uuid().nullable().default(null),
    featured: z.boolean().default(false),
    services: z
      .array(z.object({ id: z.string().uuid(), name: z.string().max(240), slug: z.string().max(180) }))
      .max(50)
      .default([]),
    outcomes: z
      .array(z.object({
        label: z.string().max(120),
        value: z.string().max(120),
        unit: z.string().max(30).nullable(),
        method: z.string().max(500),
      }))
      .max(100)
      .default([]),
    media: z
      .array(z.object({
        assetId: z.string().uuid(),
        role: imageRole,
        pairKey: z.string().max(80).nullable(),
        caption: z.string().max(500).nullable(),
        position: z.number().int(),
      }))
      .max(500)
      .default([]),
    testimonials: z
      .array(z.object({
        id: z.string().uuid(),
        displayName: z.string().max(200),
        role: z.string().max(200).nullable(),
        body: z.string().max(5_000),
        rating: z.number().int().min(1).max(5).nullable(),
      }))
      .max(100)
      .default([]),
  }),
  starter: () => ({
    projectId: "00000000-0000-4000-8000-000000000000",
    summary: null,
    clientDisplayName: null,
    occurredOn: null,
    coverAssetId: null,
    featured: false,
    services: [],
    outcomes: [],
    media: [],
    testimonials: [],
  }),
  // Generated and rebound by projects.publish; owners edit the surrounding
  // authored blocks, not a stale copy of these normalized facts.
  fieldHints: {
    projectId: { hidden: true },
    summary: { hidden: true },
    clientDisplayName: { hidden: true },
    occurredOn: { hidden: true },
    coverAssetId: { hidden: true },
    featured: { hidden: true },
    services: { hidden: true },
    outcomes: { hidden: true },
    media: { hidden: true },
    testimonials: { hidden: true },
  },
  resolve: async (props) => {
    const { resolveImage } = await import("@/core/media/service");
    const anonymous = { kind: "anonymous" } as const;
    const [cover, media] = await Promise.all([
      props.coverAssetId
        ? resolveImage.call({ id: props.coverAssetId }, anonymous)
        : Promise.resolve(null),
      Promise.all(
        props.media.map(async (item) => ({
          item,
          image: await resolveImage.call({ id: item.assetId }, anonymous),
        })),
      ),
    ]);
    return { cover, media: media.filter((item) => item.image !== null) };
  },
  render: ({ props, resolved, ctx }) => {
    const pairs = new Map<string, typeof resolved.media>();
    for (const item of resolved.media) {
      if (!item.item.pairKey) continue;
      const group = pairs.get(item.item.pairKey) ?? [];
      group.push(item);
      pairs.set(item.item.pairKey, group);
    }
    const loose = resolved.media.filter((item) => item.item.pairKey === null);
    return (
      <div className="grid gap-8">
        {resolved.cover ? (
          <picture>
            {resolved.cover.sources.map((source) => (
              <source key={source.format} srcSet={source.srcset} type={source.type} />
            ))}
            <img
              src={resolved.cover.src}
              alt={resolved.cover.altText ?? ""}
              width={resolved.cover.width ?? undefined}
              height={resolved.cover.height ?? undefined}
              className="h-auto w-full rounded-lg"
              decoding="async"
            />
          </picture>
        ) : null}

        <div className="grid max-w-prose gap-3">
          {props.summary ? <p className="text-lg text-ink-muted">{props.summary}</p> : null}
          {props.clientDisplayName || props.occurredOn ? (
            <p className="text-sm text-ink-muted">
              {[props.clientDisplayName, props.occurredOn].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>

        {props.services.length ? (
          <nav aria-label={ctx.t("projects.public.services")} className="grid gap-2">
            <h2 className="text-lg font-bold tracking-tight">{ctx.t("projects.public.services")}</h2>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {props.services.map((service) => {
                const href = ctx.localizeHref?.(`/products/${service.slug}`) ?? `/products/${service.slug}`;
                return (
                  <li key={service.id}>
                    <a href={href} className="inline-flex rounded-full border border-rule px-3 py-1 text-sm font-semibold text-ink">
                      {service.name}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        {props.outcomes.length ? (
          <section aria-labelledby={`project-${props.projectId}-outcomes`} className="grid gap-3">
            <h2 id={`project-${props.projectId}-outcomes`} className="text-lg font-bold tracking-tight">
              {ctx.t("projects.public.outcomes")}
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {props.outcomes.map((outcome, index) => (
                <div key={`${outcome.label}-${index}`} className="rounded-lg border border-rule p-4">
                  <dd className="text-2xl font-bold tabular-nums text-ink">{outcome.value}{outcome.unit ?? ""}</dd>
                  <dt className="font-semibold text-ink">{outcome.label}</dt>
                  <dd className="mt-1 text-xs text-ink-muted">{outcome.method}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {[...pairs.entries()].map(([key, items]) => (
          <section key={key} aria-label={ctx.t("projects.public.comparison")} className="grid gap-3 sm:grid-cols-2">
            {items.sort((a, b) => (a.item.role === b.item.role ? 0 : a.item.role === "before" ? -1 : 1)).map(({ item, image }) => (
              <figure key={item.assetId} className="grid gap-2">
                <picture>
                  {image!.sources.map((source) => (
                    <source key={source.format} srcSet={source.srcset} type={source.type} />
                  ))}
                  <img src={image!.src} alt={item.caption ?? image!.altText ?? ""} width={image!.width ?? undefined} height={image!.height ?? undefined} loading="lazy" decoding="async" className="h-auto w-full rounded-lg" />
                </picture>
                <figcaption className="text-sm text-ink-muted">
                  <strong className="text-ink">{ctx.t(`projects.public.${item.role}`)}</strong>
                  {item.caption ? ` · ${item.caption}` : ""}
                </figcaption>
              </figure>
            ))}
          </section>
        ))}

        {loose.length ? (
          <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
            {loose.map(({ item, image }) => (
              <li key={`${item.assetId}-${item.role}`}>
                <figure className="grid gap-2">
                  <picture>
                    {image!.sources.map((source) => (
                      <source key={source.format} srcSet={source.srcset} type={source.type} />
                    ))}
                    <img src={image!.src} alt={item.caption ?? image!.altText ?? ""} width={image!.width ?? undefined} height={image!.height ?? undefined} loading="lazy" decoding="async" className="h-auto w-full rounded-lg" />
                  </picture>
                  {item.caption ? <figcaption className="text-sm text-ink-muted">{item.caption}</figcaption> : null}
                </figure>
              </li>
            ))}
          </ul>
        ) : null}

        {props.testimonials.map((testimonial) => (
          <figure key={testimonial.id} className="grid max-w-prose gap-3 border-s-2 border-accent ps-4">
            <blockquote className="text-lg text-ink"><p>{testimonial.body}</p></blockquote>
            <figcaption className="text-sm text-ink-muted">
              {testimonial.displayName}{testimonial.role ? ` · ${testimonial.role}` : ""}
              {testimonial.rating ? ` · ${testimonial.rating}/5` : ""}
            </figcaption>
          </figure>
        ))}
      </div>
    );
  },
});

export const portfolioIndex = defineBlock({
  type: "portfolioIndex",
  labelKey: "cms.block.portfolioIndex",
  contexts: ["page"],
  schema: z.object({}),
  starter: () => ({}),
  resolve: async (_props, ctx) => {
    const { portfolioBrowse } = await import("./portfolio-service");
    const result = await portfolioBrowse.call(
      {
        service: ctx.query?.["filter[service]"] || undefined,
        collection: ctx.query?.["filter[collection]"] || undefined,
        q: ctx.query?.q || undefined,
        limit: 100,
      },
      { kind: "anonymous" },
    );
    const { resolveImage } = await import("@/core/media/service");
    const anonymous = { kind: "anonymous" } as const;
    const [projects, collections] = await Promise.all([
      Promise.all(result.projects.map(async (project) => ({
        project,
        cover: project.coverAssetId
          ? await resolveImage.call({ id: project.coverAssetId }, anonymous)
          : null,
      }))),
      Promise.all(result.collections.map(async (collection) => ({
        collection,
        cover: collection.coverAssetId
          ? await resolveImage.call({ id: collection.coverAssetId }, anonymous)
          : null,
      }))),
    ]);
    return { ...result, projects, collections };
  },
  render: ({ resolved, ctx }) => (
    <div className="grid gap-8">
      <form method="get" className="grid gap-3 rounded-lg border border-rule p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-ink">{ctx.t("projects.portfolio.filterService")}</span>
          <select name="filter[service]" defaultValue={resolved.active.service ?? ""} className="rounded-md border border-rule bg-field px-3 py-2">
            <option value="">{ctx.t("projects.portfolio.allServices")}</option>
            {resolved.services.map((service) => <option key={service.id} value={service.slug}>{service.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-ink">{ctx.t("projects.portfolio.filterCollection")}</span>
          <select name="filter[collection]" defaultValue={resolved.active.collection ?? ""} className="rounded-md border border-rule bg-field px-3 py-2">
            <option value="">{ctx.t("projects.portfolio.allCollections")}</option>
            {resolved.collections.map(({ collection }) => <option key={collection.id} value={collection.slug}>{collection.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-ink">{ctx.t("projects.portfolio.search")}</span>
          <input type="search" name="q" defaultValue={resolved.active.q ?? ""} className="rounded-md border border-rule bg-field px-3 py-2" />
        </label>
        <div className="flex flex-wrap gap-3 sm:col-span-3">
          <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent">
            {ctx.t("projects.portfolio.apply")}
          </button>
          <a href={ctx.localizeHref?.("/portfolio") ?? "/portfolio"} className="rounded-md border border-rule px-4 py-2 text-sm font-semibold text-ink">
            {ctx.t("projects.portfolio.clear")}
          </a>
        </div>
      </form>

      {resolved.collections.length ? (
        <section className="grid gap-3" aria-labelledby="portfolio-collections">
          <h2 id="portfolio-collections" className="text-lg font-bold tracking-tight">{ctx.t("projects.portfolio.collections")}</h2>
          <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {resolved.collections.map(({ collection, cover }) => (
              <li key={collection.id} className="overflow-hidden rounded-lg border border-rule">
                {cover ? (
                  <picture>
                    {cover.sources.map((source) => <source key={source.format} srcSet={source.srcset} type={source.type} />)}
                    <img src={cover.src} alt={cover.altText ?? ""} width={cover.width ?? undefined} height={cover.height ?? undefined} loading="lazy" decoding="async" className="h-auto w-full" />
                  </picture>
                ) : null}
                <div className="grid gap-1 p-4">
                  <a href={ctx.localizeHref?.(collection.href) ?? collection.href} className="font-semibold text-ink">{collection.name}</a>
                  {collection.description ? <p className="text-sm text-ink-muted">{collection.description}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3" aria-labelledby="portfolio-projects">
        <h2 id="portfolio-projects" className="text-lg font-bold tracking-tight">{ctx.t("projects.portfolio.projects")}</h2>
        {resolved.projects.length === 0 ? (
          <p className="text-sm text-ink-muted">{ctx.t("projects.portfolio.empty")}</p>
        ) : (
          <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {resolved.projects.map(({ project, cover }) => (
              <li key={project.id} className="overflow-hidden rounded-lg border border-rule">
                {cover ? (
                  <picture>
                    {cover.sources.map((source) => <source key={source.format} srcSet={source.srcset} type={source.type} />)}
                    <img src={cover.src} alt={cover.altText ?? ""} width={cover.width ?? undefined} height={cover.height ?? undefined} loading="lazy" decoding="async" className="h-auto w-full" />
                  </picture>
                ) : null}
                <div className="grid gap-1 p-4">
                  <a href={ctx.localizeHref?.(project.href) ?? project.href} className="font-semibold text-ink">{project.title}</a>
                  {project.summary ? <p className="text-sm text-ink-muted">{project.summary}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  ),
});

export const portfolioCollection = defineBlock({
  type: "portfolioCollection",
  labelKey: "cms.block.portfolioCollection",
  contexts: ["page"],
  schema: z.object({
    collectionId: z.string().uuid(),
    description: z.string().max(2_000).nullable().default(null),
    projects: z.array(portfolioProject).max(200).default([]),
  }),
  starter: () => ({
    collectionId: "00000000-0000-4000-8000-000000000000",
    description: null,
    projects: [],
  }),
  fieldHints: {
    collectionId: { hidden: true },
    description: { hidden: true },
    projects: { hidden: true },
  },
  resolve: async (props) => {
    const { portfolioBrowse } = await import("./portfolio-service");
    const { resolveImage } = await import("@/core/media/service");
    const anonymous = { kind: "anonymous" } as const;
    const live = await portfolioBrowse.call({ limit: 200 }, anonymous);
    const liveIds = new Set(live.projects.map((project) => project.id));
    return Promise.all(props.projects.filter((project) => liveIds.has(project.id)).map(async (project) => ({
      project,
      cover: project.coverAssetId
        ? await resolveImage.call({ id: project.coverAssetId }, anonymous)
        : null,
    })));
  },
  render: ({ props, resolved, ctx }) => (
    <div className="grid gap-6">
      {props.description ? <p className="max-w-prose text-lg text-ink-muted">{props.description}</p> : null}
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {resolved.map(({ project, cover }) => (
          <li key={project.id} className="overflow-hidden rounded-lg border border-rule">
            {cover ? (
              <picture>
                {cover.sources.map((source) => <source key={source.format} srcSet={source.srcset} type={source.type} />)}
                <img src={cover.src} alt={cover.altText ?? ""} width={cover.width ?? undefined} height={cover.height ?? undefined} loading="lazy" decoding="async" className="h-auto w-full" />
              </picture>
            ) : null}
            <div className="grid gap-1 p-4">
              <a href={ctx.localizeHref?.(project.href) ?? project.href} className="font-semibold text-ink">{project.title}</a>
              {project.summary ? <p className="text-sm text-ink-muted">{project.summary}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  ),
});

export default [projectCaseStudy, portfolioIndex, portfolioCollection];
