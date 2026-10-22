// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { usePathname } from "next/navigation";
import {
  Clock,
  FileText,
  Signature,
  Copy,
  CreditCard,
  Gauge,
  Hourglass,
  MagnifyingGlass,
  Sun,
  Image as ImageIcon,
  Layout,
  ListChecks,
  Quotes,
  Package,
  Palette,
  Stack,
  Truck,
  Boat,
  ShoppingCart,
  Calculator,
  ClipboardText,
  SquaresFour,
  AirplaneTakeoff,
  ArrowUUpLeft,
  ArrowBendUpRight,
  ArrowsClockwise,
  Ticket,
  DeviceMobile,
  Receipt,
  CurrencyDollar,
  MagicWand,
  Flask,
  MapPin,
  ChartLine,
  ChartBar,
  Shuffle,
  Envelope,
  Stethoscope,
  SlidersHorizontal,
  ShieldCheck,
  Translate as TranslateIcon,
  UserPlus,
  UsersThree,
  CalendarBlank,
  Newspaper,
  Megaphone,
  ShareNetwork,
  ChatCircleText,
  ChatCircleDots,
  PuzzlePiece,
  DownloadSimple,
  Kanban,
  Key,
  Lock,
  Robot,
  Gift,
  Printer,
  VideoCamera,
  Storefront,
  Star,
  Bell,
  BookOpen,
  List,
} from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";

export interface AdminNavLabels {
  region: string;
  overview: string;
  search: string;
  briefing: string;
  pages: string;
  sections: string;
  templates: string;
  design: string;
  media: string;
  forms: string;
  assessments: string;
  facts: string;
  calculators: string;
  contacts: string;
  locations: string;
  translations: string;
  traffic: string;
  experiments: string;
  health: string;
  updates: string;
  jobs: string;
  settings: string;
  retention: string;
  redirects: string;
  roles: string;
  invitations: string;
  builder: string;
  demos: string;
  invoices: string;
  payments: string;
  pos: string;
  products: string;
  collections: string;
  prices: string;
  inventory: string;
  procurement: string;
  shipping: string;
  carts: string;
  orders: string;
  fulfillment: string;
  returns: string;
  promotions: string;
  calendar: string;
  calendars: string;
  appointments: string;
  pipeline: string;
  tasks: string;
  segments: string;
  scoring: string;
  referrals: string;
  ads: string;
  assistant: string;
  social: string;
  sharing: string;
  popups: string;
  automations: string;
  documents: string;
  loyalty: string;
  inbox: string;
  messaging: string;
  projects: string;
  galleries: string;
  time: string;
  quotes: string;
  agreements: string;
  hire: string;
  events: string;
  newsletters: string;
  reports: string;
  subscriptions: string;
  access: string;
  paywalls: string;
  contribute: string;
  plugins: string;
  imports: string;
  work: string;
  gifts: string;
  printOnDemand: string;
  community: string;
  members: string;
  voiceVideo: string;
  marketplace: string;
  reviews: string;
  guidance: string;
  notifications: string;
}

// Only what exists. A nav advertising screens that are not built is a promise
// the interface cannot keep; entries arrive with their modules.
const LINKS = [
  { href: "/admin", key: "overview", module: "admin", Icon: Gauge },
  { href: "/admin/search", key: "search", module: "search", Icon: MagnifyingGlass },
  { href: "/admin/briefing", key: "briefing", module: "admin", Icon: Sun },
  { href: "/admin/guidance", key: "guidance", module: "admin", Icon: BookOpen },
  { href: "/admin/notifications", key: "notifications", module: "admin", Icon: Bell },
  { href: "/admin/pages", key: "pages", module: "cms", Icon: FileText },
  { href: "/admin/sections", key: "sections", module: "cms", Icon: Layout },
  { href: "/admin/templates", key: "templates", module: "cms", Icon: Copy },
  { href: "/admin/design", key: "design", module: "settings", Icon: Palette },
  { href: "/admin/builder", key: "builder", module: "builder", Icon: MagicWand },
  { href: "/admin/demos", key: "demos", module: "demo", Icon: Flask },
  { href: "/admin/media", key: "media", module: "media", Icon: ImageIcon },
  { href: "/admin/forms", key: "forms", module: "forms", Icon: Envelope },
  { href: "/admin/assessments", key: "assessments", module: "assessments", Icon: ListChecks },
  { href: "/admin/facts", key: "facts", module: "attestations", Icon: Quotes },
  { href: "/admin/calculators", key: "calculators", module: "calculators", Icon: Calculator },
  { href: "/admin/invoices", key: "invoices", module: "invoicing", Icon: Receipt },
  { href: "/admin/payments", key: "payments", module: "invoicing", Icon: CreditCard },
  { href: "/admin/pos", key: "pos", module: "invoicing", Icon: DeviceMobile },
  { href: "/admin/products", key: "products", module: "catalog", Icon: Package },
  { href: "/admin/collections", key: "collections", module: "catalog", Icon: SquaresFour },
  { href: "/admin/price-lists", key: "prices", module: "catalog", Icon: CurrencyDollar },
  { href: "/admin/inventory", key: "inventory", module: "catalog", Icon: Stack },
  { href: "/admin/procurement", key: "procurement", module: "catalog", Icon: Truck },
  { href: "/admin/shipping", key: "shipping", module: "catalog", Icon: Boat },
  { href: "/admin/carts", key: "carts", module: "catalog", Icon: ShoppingCart },
  { href: "/admin/orders", key: "orders", module: "catalog", Icon: ClipboardText },
  { href: "/admin/fulfillment", key: "fulfillment", module: "catalog", Icon: AirplaneTakeoff },
  { href: "/admin/returns", key: "returns", module: "catalog", Icon: ArrowUUpLeft },
  { href: "/admin/promotions", key: "promotions", module: "catalog", Icon: Ticket },
  { href: "/admin/calendar", key: "calendar", module: "connections", Icon: CalendarBlank },
  { href: "/admin/appointments", key: "appointments", module: "scheduling", Icon: CalendarBlank },
  { href: "/admin/calendars", key: "calendars", module: "scheduling", Icon: CalendarBlank },
  { href: "/admin/inbox", key: "inbox", module: "crm", Icon: ChatCircleText },
  { href: "/admin/messaging", key: "messaging", module: "crm", Icon: DeviceMobile },
  { href: "/admin/pipeline", key: "pipeline", module: "crm", Icon: Kanban },
  { href: "/admin/tasks", key: "tasks", module: "tasks", Icon: ClipboardText },
  { href: "/admin/segments", key: "segments", module: "crm", Icon: UsersThree },
  { href: "/admin/scoring", key: "scoring", module: "crm", Icon: Gauge },
  { href: "/admin/automations", key: "automations", module: "automations", Icon: Shuffle },
  { href: "/admin/projects", key: "projects", module: "projects", Icon: Kanban },
  { href: "/admin/galleries", key: "galleries", module: "galleries", Icon: ImageIcon },
  { href: "/admin/reviews", key: "reviews", module: "reviews", Icon: Star },
  { href: "/admin/documents", key: "documents", module: "documents", Icon: FileText },
  { href: "/admin/time", key: "time", module: "time", Icon: Clock },
  { href: "/admin/quotes", key: "quotes", module: "quotes", Icon: Receipt },
  { href: "/admin/agreements", key: "agreements", module: "contracts", Icon: Signature },
  { href: "/admin/hire", key: "hire", module: "rentals", Icon: Package },
  { href: "/admin/events", key: "events", module: "events", Icon: CalendarBlank },
  { href: "/admin/newsletters", key: "newsletters", module: "newsletters", Icon: Newspaper },
  { href: "/admin/referrals", key: "referrals", module: "referrals", Icon: UserPlus },
  { href: "/admin/ads", key: "ads", module: "ads", Icon: Megaphone },
  { href: "/admin/assistant", key: "assistant", module: "assistant", Icon: Robot },
  { href: "/admin/social", key: "social", module: "social", Icon: ShareNetwork },
  { href: "/admin/sharing", key: "sharing", module: "share", Icon: ShareNetwork },
  { href: "/admin/popups", key: "popups", module: "popups", Icon: ChatCircleDots },
  { href: "/admin/loyalty", key: "loyalty", module: "loyalty", Icon: Ticket },
  { href: "/admin/gifts", key: "gifts", module: "giftRegistry", Icon: Gift },
  { href: "/admin/print-on-demand", key: "printOnDemand", module: "printOnDemand", Icon: Printer },
  { href: "/admin/members", key: "members", module: "members", Icon: UsersThree },
  { href: "/admin/community", key: "community", module: "community", Icon: UsersThree },
  { href: "/admin/voice-video", key: "voiceVideo", module: "voiceVideo", Icon: VideoCamera },
  { href: "/admin/marketplace", key: "marketplace", module: "marketplace", Icon: Storefront },
  {
    href: "/admin/subscriptions",
    key: "subscriptions",
    module: "subscriptions",
    Icon: ArrowsClockwise,
  },
  { href: "/admin/access", key: "access", module: "entitlements", Icon: Key },
  { href: "/admin/paywalls", key: "paywalls", module: "paywalls", Icon: Lock },
  { href: "/admin/contacts", key: "contacts", module: "contacts", Icon: UsersThree },
  { href: "/admin/locations", key: "locations", module: "locations", Icon: MapPin },
  { href: "/admin/translations", key: "translations", module: "i18n", Icon: TranslateIcon },
  { href: "/admin/traffic", key: "traffic", module: "analytics", Icon: ChartLine },
  { href: "/admin/reports", key: "reports", module: "reporting", Icon: ChartBar },
  { href: "/admin/experiments", key: "experiments", module: "analytics", Icon: Shuffle },
  { href: "/admin/roles", key: "roles", module: "roles", Icon: ShieldCheck },
  { href: "/admin/invitations", key: "invitations", module: "invitations", Icon: UserPlus },
  { href: "/admin/settings", key: "settings", module: "settings", Icon: SlidersHorizontal },
  { href: "/admin/retention", key: "retention", module: "retention", Icon: Hourglass },
  { href: "/admin/redirects", key: "redirects", module: "seo", Icon: ArrowBendUpRight },
  { href: "/admin/work", key: "work", module: "agents", Icon: Kanban },
  { href: "/admin/contribute", key: "contribute", module: "contribute", Icon: ChatCircleText },
  { href: "/admin/plugins", key: "plugins", module: "platform", Icon: PuzzlePiece },
  { href: "/admin/imports", key: "imports", module: "platform", Icon: DownloadSimple },
  { href: "/admin/health", key: "health", module: "platform", Icon: Stethoscope },
  { href: "/admin/updates", key: "updates", module: "platform", Icon: ArrowsClockwise },
  { href: "/admin/jobs", key: "jobs", module: "platform", Icon: ListChecks },
] as const;

export type AdminNavKey = (typeof LINKS)[number]["key"];
export type AdminNavGroupKey =
  | "home"
  | "website"
  | "sell"
  | "bookings"
  | "customers"
  | "marketing"
  | "system";

export type AdminNavGroupLabels = Record<AdminNavGroupKey, string> & {
  /** The phone-width disclosure button. */
  menu: string;
};

/**
 * How the screens are arranged for a person, not how the code is split into
 * modules. Twenty-eight screens in four wrapping rows was a wall a new owner
 * had to read end to end; a handful of named groups lets them skip straight
 * to "the shop" or "my customers". Every link belongs to exactly one group —
 * `tests/core/admin-nav-layout.test.ts` holds that — and which links show is
 * still decided by `LINKS` and the grants below, never by the grouping.
 */
export const ADMIN_NAV_GROUPS: ReadonlyArray<{
  key: AdminNavGroupKey;
  links: readonly AdminNavKey[];
}> = [
  { key: "home", links: ["overview", "search", "briefing", "guidance", "notifications"] },
  {
    key: "website",
    links: [
      "pages", "sections", "templates", "design", "media", "forms", "popups",
      "builder", "demos", "translations", "redirects", "assessments", "facts",
      "calculators",
    ],
  },
  {
    key: "sell",
    links: [
      "products", "collections", "prices", "inventory", "procurement",
      "shipping", "carts", "orders", "fulfillment", "returns", "promotions",
      "invoices", "payments", "pos", "subscriptions", "access", "paywalls",
      "loyalty", "gifts", "printOnDemand", "marketplace",
    ],
  },
  {
    key: "bookings",
    links: [
      "calendar", "appointments", "calendars", "events", "hire", "quotes",
      "agreements", "projects", "galleries", "documents", "time", "tasks",
    ],
  },
  {
    key: "customers",
    links: [
      "contacts", "inbox", "messaging", "pipeline", "segments", "scoring",
      "members", "community", "reviews", "referrals", "voiceVideo",
    ],
  },
  {
    key: "marketing",
    links: [
      "newsletters", "ads", "social", "sharing", "automations", "assistant",
      "traffic", "reports", "experiments",
    ],
  },
  {
    key: "system",
    links: [
      "settings", "locations", "roles", "invitations", "retention", "work",
      "contribute", "plugins", "imports", "health", "updates", "jobs",
    ],
  },
];

/** Every nav entry, for the grouping and title tests. */
export const ADMIN_NAV_ENTRIES: ReadonlyArray<{ key: AdminNavKey; href: string }> =
  LINKS.map(({ key, href }) => ({ key, href }));

/** `/admin/calendar` is not active on `/admin/calendars`: match whole segments. */
export function isActiveAdminHref(href: string, pathname: string): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({
  labels,
  groupLabels,
  multilingual,
  grants,
  owner,
}: {
  labels: AdminNavLabels;
  groupLabels: AdminNavGroupLabels;
  /**
   * Whether the site publishes more than one language. Translations is the
   * one entry that is conditional: on a single-language site it leads to a
   * screen with nothing on it, and a nav entry that goes nowhere teaches
   * people to stop reading the nav.
   */
  multilingual: boolean;
  grants: ReadonlyArray<{ module: string; access: "view" | "manage" }>;
  owner: boolean;
}) {
  const pathname = usePathname();
  const links = LINKS.filter((link) => {
    if (link.key === "translations" && !multilingual) return false;
    if (link.key === "builder" && !owner) return false;
    return grants.some(
      (grant) => grant.module === "*" || grant.module === link.module,
    );
  });
  const byKey = new Map<AdminNavKey, (typeof links)[number]>(
    links.map((link) => [link.key, link]),
  );
  const current = links.find((link) => isActiveAdminHref(link.href, pathname));

  const groups = ADMIN_NAV_GROUPS.map((group) => {
    const items = group.links.flatMap((key) => {
      const link = byKey.get(key);
      return link ? [link] : [];
    });
    if (items.length === 0) return null;
    const headingId = `admin-nav-${group.key}`;
    return (
      <div key={group.key} className="pb-3">
        <p
          id={headingId}
          className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted"
        >
          {groupLabels[group.key]}
        </p>
        <ul aria-labelledby={headingId} className="grid list-none gap-0.5 p-0">
          {items.map(({ href, key, Icon }) => {
            const active = isActiveAdminHref(href, pathname);
            return (
              <li key={href}>
                <a
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-2 rounded-md border-s-2 px-3 py-1.5 text-sm hover:bg-surface-muted hover:text-ink",
                    active
                      ? "border-accent bg-surface-muted font-semibold text-ink"
                      : "border-transparent text-ink-muted",
                  )}
                >
                  <Icon size={16} weight={active ? "fill" : "regular"} />
                  {labels[key]}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    );
  });

  return (
    // A sidebar from the lg breakpoint; below it, one "Menu" toggle so the
    // page's own content starts near the top of a phone screen instead of
    // under every link the admin has.
    //
    // One list, rendered once: a second copy for phones put every link in
    // the document twice, which broke "the invitations link" for anyone
    // (or any test) looking for it. The toggle is a real checkbox styled as
    // a button, so it works before and without JavaScript, is reachable by
    // keyboard (Space toggles it) and reports its state to a screen reader;
    // Escape closes the open menu back to it. The sidebar scrolls with the
    // page rather than inside its own box, so no link is clipped out of
    // sight (axe could not judge the contrast of links scrolled away).
    <nav
      aria-label={labels.region}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        const toggle = event.currentTarget.querySelector<HTMLInputElement>("#admin-nav-toggle");
        if (!toggle?.checked) return;
        toggle.checked = false;
        toggle.focus();
      }}
    >
      <input
        id="admin-nav-toggle"
        type="checkbox"
        aria-controls="admin-nav-groups"
        className="peer sr-only lg:hidden"
      />
      <label
        htmlFor="admin-nav-toggle"
        className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-rule bg-surface px-3 py-2 text-start text-sm font-semibold text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent lg:hidden"
      >
        <List size={16} weight="bold" aria-hidden="true" />
        <span>{groupLabels.menu}</span>
        {current ? (
          <span className="ms-auto truncate font-normal text-ink-muted">
            {labels[current.key]}
          </span>
        ) : null}
      </label>
      <div id="admin-nav-groups" className="hidden pt-2 peer-checked:block lg:block lg:pt-0">
        {groups}
      </div>
    </nav>
  );
}
