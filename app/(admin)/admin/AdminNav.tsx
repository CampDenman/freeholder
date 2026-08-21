// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { usePathname } from "next/navigation";
import {
  FileText,
  Copy,
  CreditCard,
  Gauge,
  Sun,
  Image as ImageIcon,
  Layout,
  ListChecks,
  Package,
  Palette,
  Stack,
  Truck,
  Boat,
  ShoppingCart,
  ClipboardText,
  AirplaneTakeoff,
  ArrowUUpLeft,
  Ticket,
  DeviceMobile,
  Receipt,
  CurrencyDollar,
  MagicWand,
  Flask,
  MapPin,
  ChartLine,
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
  ChatCircleText,
  PuzzlePiece,
  DownloadSimple,
  Kanban,
} from "@phosphor-icons/react/dist/ssr";
import { cx } from "@/ui/primitives";

export interface AdminNavLabels {
  region: string;
  overview: string;
  briefing: string;
  pages: string;
  sections: string;
  templates: string;
  design: string;
  media: string;
  forms: string;
  contacts: string;
  locations: string;
  translations: string;
  traffic: string;
  experiments: string;
  health: string;
  jobs: string;
  settings: string;
  roles: string;
  invitations: string;
  builder: string;
  demos: string;
  invoices: string;
  payments: string;
  pos: string;
  products: string;
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
  events: string;
  newsletters: string;
  contribute: string;
  plugins: string;
  imports: string;
  work: string;
}

// Only what exists. A nav advertising screens that are not built is a promise
// the interface cannot keep; entries arrive with their modules.
const LINKS = [
  { href: "/admin", key: "overview", module: "admin", Icon: Gauge },
  { href: "/admin/briefing", key: "briefing", module: "admin", Icon: Sun },
  { href: "/admin/pages", key: "pages", module: "cms", Icon: FileText },
  { href: "/admin/sections", key: "sections", module: "cms", Icon: Layout },
  { href: "/admin/templates", key: "templates", module: "cms", Icon: Copy },
  { href: "/admin/design", key: "design", module: "settings", Icon: Palette },
  { href: "/admin/builder", key: "builder", module: "builder", Icon: MagicWand },
  { href: "/admin/demos", key: "demos", module: "demo", Icon: Flask },
  { href: "/admin/media", key: "media", module: "media", Icon: ImageIcon },
  { href: "/admin/forms", key: "forms", module: "forms", Icon: Envelope },
  { href: "/admin/invoices", key: "invoices", module: "invoicing", Icon: Receipt },
  { href: "/admin/payments", key: "payments", module: "invoicing", Icon: CreditCard },
  { href: "/admin/pos", key: "pos", module: "invoicing", Icon: DeviceMobile },
  { href: "/admin/products", key: "products", module: "catalog", Icon: Package },
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
  { href: "/admin/events", key: "events", module: "events", Icon: CalendarBlank },
  { href: "/admin/newsletters", key: "newsletters", module: "newsletters", Icon: Newspaper },
  { href: "/admin/contacts", key: "contacts", module: "contacts", Icon: UsersThree },
  { href: "/admin/locations", key: "locations", module: "locations", Icon: MapPin },
  { href: "/admin/translations", key: "translations", module: "i18n", Icon: TranslateIcon },
  { href: "/admin/traffic", key: "traffic", module: "analytics", Icon: ChartLine },
  { href: "/admin/experiments", key: "experiments", module: "analytics", Icon: Shuffle },
  { href: "/admin/roles", key: "roles", module: "roles", Icon: ShieldCheck },
  { href: "/admin/invitations", key: "invitations", module: "invitations", Icon: UserPlus },
  { href: "/admin/settings", key: "settings", module: "settings", Icon: SlidersHorizontal },
  { href: "/admin/work", key: "work", module: "agents", Icon: Kanban },
  { href: "/admin/contribute", key: "contribute", module: "contribute", Icon: ChatCircleText },
  { href: "/admin/plugins", key: "plugins", module: "platform", Icon: PuzzlePiece },
  { href: "/admin/imports", key: "imports", module: "platform", Icon: DownloadSimple },
  { href: "/admin/health", key: "health", module: "platform", Icon: Stethoscope },
  { href: "/admin/jobs", key: "jobs", module: "platform", Icon: ListChecks },
] as const;

export function AdminNav({
  labels,
  multilingual,
  grants,
  owner,
}: {
  labels: AdminNavLabels;
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
  return (
    <nav aria-label={labels.region}>
      <ul className="-mb-px flex list-none flex-wrap gap-1 p-0">
        {links.map(({ href, key, Icon }) => {
          const active =
            href === "/admin" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <a
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm",
                  active
                    ? "border-accent font-semibold text-ink"
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
    </nav>
  );
}
