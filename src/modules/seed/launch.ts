// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The launch template (MASTER.md §43 C3.35).
//
// A launch spec is a small JSON document an agent or a planning tool writes
// from an approved business plan: the business's name and promise, its brand
// colours, one priced offer, how a visitor gets in touch or books a call, and
// an honest account of what is live and what is still planned. Installing it
// turns an empty instance into a working one-offer site in one transaction:
// server-rendered pages, enquiry, offer-request and call-request forms that
// land on the contact spine, and the platform's own robots, sitemap,
// llms.txt, OG images and manifest.
//
// Same rule as the demo (service.ts): every write goes through an ordinary
// service, so a launched site can only contain what its owner could have made
// by hand, and an owner edits it afterwards like any other site. It refuses a
// site that already has pages.
//
// Status copy is required, not optional. A preview built from a plan has no
// payments, no mailbox and no domain yet; the spec has to say so, and the
// installer puts that statement in the announcement bar of every page and on
// a /status page, so nothing a visitor reads can claim otherwise.
import { readFile } from "node:fs/promises";
import { count } from "drizzle-orm";
import { z } from "zod";
import { defineService, listServices, ServiceError } from "@/core/service";
import { completeSetup, updateBusiness } from "@/core/settings/service";
import { updateDesign } from "@/core/design/service";
import { pages } from "@/modules/cms/schema";
import {
  createPage,
  ensureDefaults,
  listPages,
  publishPage,
  updatePage,
  updateSection,
} from "@/modules/cms/service";
import { FOOTER_KEY, HEADER_KEY, NAV_KEY } from "@/modules/cms/defaults";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { createForm } from "@/modules/forms/service";

// ── The spec ────────────────────────────────────────────────────────────────

const line = (max: number) => z.string().trim().min(1).max(max);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);
const RESERVED_SLUGS = new Set(["about", "contact", "status", "intro-call", "start", "portal", "book", "call", "admin", "api", "login", "setup", "preview", "preview-access"]);

/** One onboarding question (C3.39): an ordinary form field, including C3.38 files. */
const intakeFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine((key) => key !== "name" && key !== "email", "name and email are asked for already"),
    label: line(120),
    kind: z.enum(["text", "email", "multiline", "select", "file"]),
    required: z.boolean().default(false),
    help: line(300).optional(),
    options: z.array(line(80)).min(1).max(12).optional(),
    accept: z.array(z.enum(["audio", "doc", "image"])).min(1).max(3).optional(),
    maxMb: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.kind === "file" && !field.accept) ctx.addIssue({ code: "custom", message: "a file question names what it accepts" });
    if (field.kind !== "file" && (field.accept || field.maxMb)) ctx.addIssue({ code: "custom", message: "only a file question takes accept and maxMb" });
    if (field.kind === "select" && !field.options) ctx.addIssue({ code: "custom", message: "a choice question lists its options" });
  });

export const launchSpecSchema = z
  .object({
    format: z.literal("freeholder-launch-spec"),
    /**
     * 1 is the C3.35 one-offer site. 2 (C3.39) adds customer accounts, an
     * onboarding intake on /start and payment-step copy; a version 1 spec
     * installs exactly as it always did.
     */
    version: z.union([z.literal(1), z.literal(2)]),
    /** Who wrote the spec, for the audit trail: a planning tool or an agent. */
    generator: line(120),
    business: z
      .object({
        name: line(120),
        tagline: line(160),
        schemaType: line(60).default("ProfessionalService"),
        country: z.string().length(2).toUpperCase().default("US"),
        baseCurrency: z.string().length(3).toUpperCase().default("USD"),
        timezone: line(60).default("America/Los_Angeles"),
      })
      .strict(),
    /** Light-scheme brand tokens. Refused by the design service if they fail WCAG AA. */
    brand: z.object({ paper: hex.optional(), ink: hex.optional(), accent: hex.optional() }).strict().default({}),
    status: z
      .object({
        /** One line on every page, e.g. "Preview: payments are not connected yet." */
        banner: line(240),
        summary: line(600),
        ready: z.array(line(200)).min(1).max(12),
        planned: z.array(line(200)).min(1).max(12),
      })
      .strict(),
    home: z
      .object({
        headline: line(120),
        promise: line(300),
        problem: z.array(line(400)).min(1).max(6),
        steps: z.array(line(300)).min(1).max(6),
        switchReasons: z.array(line(300)).max(6).default([]),
        seoDescription: line(160),
      })
      .strict(),
    offer: z
      .object({
        slug: slug.refine((value) => !RESERVED_SLUGS.has(value), "that slug is one of the site's own pages"),
        name: line(120),
        summary: line(600),
        /** The amount, in the base currency's major unit. */
        price: z.string().regex(/^\d{1,7}\.\d{2}$/),
        cadence: z.enum(["one_time", "monthly"]),
        priceLabel: line(80),
        forWho: line(400),
        includes: z.array(line(240)).min(1).max(10),
        faq: z.array(z.object({ question: line(200), answer: line(800) }).strict()).max(8).default([]),
        seoDescription: line(160),
      })
      .strict(),
    /**
     * A free intro call a visitor requests on /intro-call. A request, not a
     * calendar booking: the owner replies with a time. (Freeholder's booking
     * flow prices every bookable service, so a free call is a form.)
     */
    intro: z
      .object({
        name: line(80),
        summary: line(200),
        durationMin: z.number().int().min(10).max(120),
      })
      .strict()
      .optional(),
    contact: z.object({ intro: line(600), seoDescription: line(160) }).strict(),
    about: z.object({ body: z.array(line(1200)).min(1).max(6), seoDescription: line(160) }).strict(),
    /** Version 2: customers sign up and sign in, and follow their requests in My Account. */
    accounts: z.object({ enabled: z.boolean() }).strict().optional(),
    /** Version 2: the onboarding questionnaire on /start, an intake that opens a project (C3.37). */
    intake: z
      .object({
        title: line(80),
        intro: line(400),
        projectTitle: line(200),
        fields: z.array(intakeFieldSchema).min(1).max(12),
      })
      .strict()
      .optional(),
    /** Version 2: what the payment step says while payments run in test mode. */
    payments: z.object({ mode: z.literal("test"), note: line(300) }).strict().optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const v2 = [spec.accounts, spec.intake, spec.payments];
    if (spec.version === 1 && v2.some(Boolean)) {
      ctx.addIssue({ code: "custom", message: "accounts, intake and payments need a version 2 spec" });
    }
    if (spec.version === 2 && !v2.every(Boolean)) {
      ctx.addIssue({ code: "custom", message: "a version 2 spec states accounts, intake and payments" });
    }
  });

export type LaunchSpec = z.output<typeof launchSpecSchema>;
export type LaunchSpecInput = z.input<typeof launchSpecSchema>;

// ── Rich text helpers ───────────────────────────────────────────────────────

const span = (text: string) => ({ type: "text" as const, text });
const paragraphs = (...texts: string[]) => texts.map((text) => ({ type: "paragraph" as const, children: [span(text)] }));
const bullets = (items: string[]) => ({ type: "bulletList" as const, children: items.map((text) => ({ type: "listItem" as const, children: [span(text)] })) });
const ordered = (items: string[]) => ({ type: "orderedList" as const, children: items.map((text) => ({ type: "listItem" as const, children: [span(text)] })) });

const h = (id: string, text: string, level: 1 | 2 = 2): BlockNode => ({ id, type: "heading", props: { text, level, align: "start" } });
const body = (id: string, doc: unknown[]): BlockNode => ({ id, type: "text", props: { body: doc, align: "start", measure: true } });
const button = (id: string, label: string, href: string, variant: "solid" | "quiet" = "solid"): BlockNode => ({ id, type: "button", props: { label, href, variant } });

// ── What the spec becomes ──────────────────────────────────────────────────

export const LAUNCH_FORMS = {
  contact: "contact",
  offer: "offer-request",
  call: "call-request",
  onboarding: "onboarding",
} as const;

interface LaunchPage {
  slug: string;
  title: string;
  seo: { title: string; description: string };
  blocks: BlockNode[];
}

/** The pages a spec installs. Pure, so the shape is testable without a database. */
export function launchPages(spec: LaunchSpec): LaunchPage[] {
  const { business, home, offer, intro, status, contact, about } = spec;
  const offerHref = `/${offer.slug}`;
  const working = Boolean(spec.accounts?.enabled && spec.intake);
  const cta: BlockNode[] = working
    ? [button("cta-start", spec.intake!.title, "/start"), button("cta-offer", `See ${offer.name}`, offerHref, "quiet")]
    : [button("cta-offer", `See ${offer.name}`, offerHref)];
  if (intro) cta.push(button("cta-call", `Request a ${intro.durationMin}-minute call`, "/intro-call", "quiet"));
  const homeBlocks: BlockNode[] = [
    h("home-h1", home.headline, 1),
    body("home-promise", paragraphs(home.promise)),
    ...cta,
    h("home-problem-h", "The problem"),
    body("home-problem", paragraphs(...home.problem)),
    h("home-how-h", "How it works"),
    body("home-how", [ordered(home.steps)]),
  ];
  if (home.switchReasons.length) {
    homeBlocks.push(h("home-switch-h", "Why switch"), body("home-switch", [bullets(home.switchReasons)]));
  }
  homeBlocks.push(
    h("home-price-h", offer.priceLabel),
    body("home-price", paragraphs(offer.summary)),
    button("home-price-cta", `Request ${offer.name}`, `${offerHref}#request`),
    h("home-status-h", "What is ready and what is planned"),
    body("home-status", paragraphs(status.summary)),
    button("home-status-cta", "Read the full status", "/status", "quiet"),
  );

  const offerBlocks: BlockNode[] = [
    h("offer-h1", offer.name, 1),
    body("offer-summary", paragraphs(offer.summary)),
    h("offer-price-h", offer.priceLabel),
    body("offer-for", paragraphs(offer.forWho)),
    h("offer-includes-h", "What is included"),
    body("offer-includes", [bullets(offer.includes)]),
  ];
  if (offer.faq.length) offerBlocks.push({ id: "offer-faq", type: "faq", props: { items: offer.faq } });
  offerBlocks.push(
    h("request", `Request ${offer.name}`),
    body("offer-request-note", paragraphs(status.banner)),
    { id: "offer-form", type: "form", props: { formSlug: LAUNCH_FORMS.offer } },
  );
  if (intro) offerBlocks.push(button("offer-call", `Or request a ${intro.durationMin}-minute call`, "/intro-call", "quiet"));
  if (working) offerBlocks.splice(4, 0, button("offer-start", spec.intake!.title, "/start"));

  const contactBlocks: BlockNode[] = [
    h("contact-h1", "Contact", 1),
    body("contact-intro", paragraphs(contact.intro)),
    { id: "contact-form", type: "form", props: { formSlug: LAUNCH_FORMS.contact } },
  ];
  if (intro) contactBlocks.push(button("contact-call", `Request a ${intro.durationMin}-minute call`, "/intro-call", "quiet"));

  const callPages: LaunchPage[] = intro
    ? [
        {
          slug: "intro-call",
          title: intro.name,
          seo: {
            title: `${intro.name} with ${business.name}`.slice(0, 60),
            description: `${intro.summary} Request a ${intro.durationMin}-minute call with ${business.name}.`.slice(0, 160),
          },
          blocks: [
            h("call-h1", intro.name, 1),
            body("call-summary", paragraphs(intro.summary, `Tell us two or three times that suit you. The owner replies by email to confirm one; there is no calendar booking yet.`)),
            { id: "call-form", type: "form", props: { formSlug: LAUNCH_FORMS.call } },
          ],
        },
      ]
    : [];

  return [
    {
      slug: "",
      title: business.name,
      seo: { title: `${business.name}: ${business.tagline}`.slice(0, 60), description: home.seoDescription },
      blocks: homeBlocks,
    },
    {
      slug: offer.slug,
      title: offer.name,
      seo: { title: `${offer.name} (${offer.priceLabel})`.slice(0, 60), description: offer.seoDescription },
      blocks: offerBlocks,
    },
    {
      slug: "about",
      title: "About",
      seo: { title: `About ${business.name}`.slice(0, 60), description: about.seoDescription },
      blocks: [h("about-h1", `About ${business.name}`, 1), body("about-body", paragraphs(...about.body))],
    },
    {
      slug: "status",
      title: "Status",
      seo: {
        title: `${business.name} status`.slice(0, 60),
        description: `What is ready at ${business.name} and what is still planned.`.slice(0, 160),
      },
      blocks: [
        h("status-h1", "What is ready and what is planned", 1),
        body("status-summary", paragraphs(status.summary)),
        h("status-ready-h", "Ready"),
        body("status-ready", [bullets(status.ready)]),
        h("status-planned-h", "Planned, not live"),
        body("status-planned", [bullets(status.planned)]),
      ],
    },
    {
      slug: "contact",
      title: "Contact",
      seo: { title: `Contact ${business.name}`.slice(0, 60), description: contact.seoDescription },
      blocks: contactBlocks,
    },
    ...callPages,
    ...startPages(spec),
  ];
}

/** Version 2: /start, where a customer signs in, onboards and reaches the payment step. */
function startPages(spec: LaunchSpec): LaunchPage[] {
  if (!spec.intake || !spec.accounts?.enabled) return [];
  const { intake, payments, business } = spec;
  return [
    {
      slug: "start",
      title: intake.title,
      seo: {
        title: `${intake.title} with ${business.name}`.slice(0, 60),
        description: `${intake.intro}`.slice(0, 160),
      },
      blocks: [
        h("start-h1", intake.title, 1),
        body("start-intro", paragraphs(intake.intro)),
        h("start-account-h", "1. Your account"),
        body("start-account", paragraphs("Sign in with your email to upload files and follow your request in My Account. New here? The same step creates your account.")),
        button("start-account-cta", "Sign in or create an account", "/portal/login"),
        h("start-intake-h", "2. Tell us what you need"),
        { id: "start-form", type: "form", props: { formSlug: LAUNCH_FORMS.onboarding } },
        h("start-payment-h", "3. Payment"),
        body("start-payment", paragraphs(payments?.note ?? "Payments run in test mode.")),
        button("start-account-link", "Open My Account", "/portal", "quiet"),
      ],
    },
  ];
}

export function launchNav(spec: LaunchSpec) {
  const links = [{ label: spec.offer.name, href: `/${spec.offer.slug}` }];
  if (spec.intro) links.push({ label: "Request a call", href: "/intro-call" });
  if (spec.intake && spec.accounts?.enabled) links.unshift({ label: spec.intake.title, href: "/start" });
  links.push({ label: "About", href: "/about" }, { label: "Status", href: "/status" }, { label: "Contact", href: "/contact" });
  if (spec.accounts?.enabled) links.push({ label: "My account", href: "/portal" });
  return links;
}

/**
 * The offer request is an intake (C3.37): each accepted request opens a
 * project for the person who sent it, which the owner works and delivers and
 * the customer follows in My Account. Only where the projects module is
 * installed; without it the form is an ordinary enquiry, as before. The spec
 * itself is unchanged, so every version 1 spec installs exactly as it did.
 */
function offerIntake(spec: LaunchSpec) {
  if (!listServices().has("projects.openFromIntake")) return undefined;
  return { projectTitle: `${spec.offer.name} for {name}`.slice(0, 200) };
}

/** Version 2's onboarding form: who it is from, then the spec's questions, as an intake. */
function onboardingForm(spec: LaunchSpec) {
  if (!spec.intake || !spec.accounts?.enabled) return [];
  const intake = spec.intake;
  return [
    {
      slug: LAUNCH_FORMS.onboarding,
      name: intake.title,
      submitLabel: "Send",
      successMessage: "Thank you. Your request is in My Account, where you can follow it and download the delivery.",
      intake: listServices().has("projects.openFromIntake") ? { projectTitle: intake.projectTitle } : undefined,
      fields: [
        { key: "name", label: "Your name", kind: "text" as const, required: true },
        { key: "email", label: "Email", kind: "email" as const, required: true },
        ...intake.fields.map((field) => ({
          key: field.key,
          label: field.label,
          kind: field.kind,
          required: field.required,
          ...(field.help ? { help: field.help } : {}),
          ...(field.options ? { options: field.options } : {}),
          ...(field.accept ? { accept: field.accept } : {}),
          ...(field.maxMb ? { maxMb: field.maxMb } : {}),
        })),
      ],
    },
  ];
}

const LAUNCH_FORM_DEFINITIONS = (spec: LaunchSpec) => [
  ...onboardingForm(spec),
  ...(spec.intro
    ? [
        {
          slug: LAUNCH_FORMS.call,
          name: "Call request",
          submitLabel: "Request a call",
          successMessage: "Thank you. Your request is saved; the owner will reply by email to confirm a time.",
          fields: [
            { key: "name", label: "Your name", kind: "text" as const, required: true },
            { key: "email", label: "Email", kind: "email" as const, required: true },
            { key: "times", label: "Two or three times that suit you, with your time zone", kind: "text" as const, required: true },
            { key: "message", label: "What would you like to cover?", kind: "multiline" as const },
          ],
        },
      ]
    : []),
  {
    slug: LAUNCH_FORMS.contact,
    name: "Enquiry",
    submitLabel: "Send",
    successMessage: "Thank you. Your message is saved for the owner, who will reply by email.",
    fields: [
      { key: "name", label: "Your name", kind: "text" as const, required: true },
      { key: "email", label: "Email", kind: "email" as const, required: true },
      { key: "message", label: "How can we help?", kind: "multiline" as const, required: true },
    ],
  },
  {
    slug: LAUNCH_FORMS.offer,
    name: `${spec.offer.name} request`.slice(0, 120),
    submitLabel: "Send request",
    successMessage: "Thank you. Your request is saved. Nothing has been charged; the owner will reply by email.",
    intake: offerIntake(spec),
    fields: [
      { key: "name", label: "Your name", kind: "text" as const, required: true },
      { key: "email", label: "Email", kind: "email" as const, required: true },
      { key: "company", label: "Business or website", kind: "text" as const },
      { key: "message", label: "What do you need?", kind: "multiline" as const, required: true },
    ],
  },
];

// ── Installing ─────────────────────────────────────────────────────────────

export const installLaunch = defineService({
  name: "launch.install",
  summary: "Turn an empty site into a one-offer site from a launch spec.",
  kind: "mutation",
  // Owner rather than staff, as demo.install: it rewrites the business
  // profile. `system` reaches it at boot when FREEHOLDER_LAUNCH_SPEC is set.
  permission: "scoped",
  writeClass: "write",
  input: launchSpecSchema,
  output: z.object({
    business: z.string(),
    pages: z.array(z.string()),
    forms: z.array(z.string()),
    /** Forms whose accepted submissions open a project (C3.37). */
    intakeForms: z.array(z.string()),
    callRequest: z.boolean(),
    brandApplied: z.boolean(),
  }),
  handler: async (spec, ctx) => {
    const [populated] = await ctx.tx.select({ n: count() }).from(pages);
    if ((populated?.n ?? 0) > 0) {
      throw new ServiceError("conflict", "This instance already has pages. A launch spec only installs into an empty site.");
    }
    const { business } = spec;
    await ctx.callAsSystem(updateBusiness, {
      name: business.name,
      tagline: business.tagline,
      schemaType: business.schemaType,
      country: business.country,
      defaultLocale: "en",
      enabledLocales: ["en"],
      baseCurrency: business.baseCurrency,
      timezone: business.timezone,
      units: "metric",
      firstDayOfWeek: 1,
    });

    // The brand is the plan's design guide. A pairing that fails WCAG AA is
    // refused by the design service before it writes; the site then keeps the
    // platform's accessible defaults rather than failing the whole launch.
    let brandApplied = false;
    const colors = Object.fromEntries(Object.entries(spec.brand).filter(([, v]) => v));
    if (Object.keys(colors).length) {
      try {
        await ctx.callAsSystem(updateDesign, { colors: { light: colors } });
        brandApplied = true;
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
      }
    }

    const forms = LAUNCH_FORM_DEFINITIONS(spec);
    for (const form of forms) await ctx.callAsSystem(createForm, form);

    await ctx.callAsSystem(ensureDefaults, {});
    await ctx.callAsSystem(updateSection, {
      key: HEADER_KEY,
      name: "Header",
      blocks: [
        { id: "launch-status", type: "announcement", props: { text: spec.status.banner, href: "/status" } },
        {
          id: "launch-header",
          type: "chromeBar",
          props: { align: "between" },
          children: [{ id: "launch-brand", type: "brand", props: { href: "/", showTagline: true } }],
        },
      ],
    });
    await ctx.callAsSystem(updateSection, {
      key: NAV_KEY,
      name: "Navigation",
      blocks: [{ id: "chrome-nav", type: "nav", props: { links: launchNav(spec), ariaLabelKey: "cms.nav.primary" } }],
    });
    await ctx.callAsSystem(updateSection, {
      key: FOOTER_KEY,
      name: "Footer",
      blocks: [
        body("launch-footer-status", paragraphs(spec.status.banner)),
        {
          id: "launch-footer-nav",
          type: "nav",
          props: { links: launchNav(spec), ariaLabelKey: "cms.nav.footer", collapseOnMobile: false },
        },
      ],
    });

    const existing = new Map((await ctx.callAsSystem(listPages, {})).map((page) => [page.slug, page.id]));
    const installed: string[] = [];
    for (const page of launchPages(spec)) {
      const priorId = existing.get(page.slug);
      const row = priorId
        ? await ctx.callAsSystem(updatePage, { id: priorId, title: page.title, blocks: page.blocks, seo: page.seo })
        : await ctx.callAsSystem(createPage, { slug: page.slug, title: page.title, blocks: page.blocks, seo: page.seo });
      await ctx.callAsSystem(publishPage, { id: row.id, published: true });
      installed.push(page.slug);
    }

    await ctx.callAsSystem(completeSetup, {});
    ctx.queueEvent("launch.installed", { pages: installed.length, generator: spec.generator });
    return {
      business: business.name,
      pages: installed,
      forms: forms.map((form) => form.slug),
      intakeForms: forms.filter((form) => "intake" in form && form.intake).map((form) => form.slug),
      callRequest: Boolean(spec.intro),
      brandApplied,
    };
  },
});

/** Read and validate a spec file. Errors name the field, never echo the file. */
export async function readLaunchSpec(path: string): Promise<LaunchSpec> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const parsed = launchSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`).join("; ");
    throw new Error(`The launch spec is not valid: ${where}`);
  }
  return parsed.data;
}
