// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The initial role catalogue for MASTER.md §43 C1.01.
//
// These are seed records, not permission branches. Once written, the database
// is authoritative and the owner can tune the grants. Adding a role here does
// not teach `permits()` anything about its name.
import { roleGrants, roles } from "@/core/auth/schema";
import type { Tx } from "@/core/service";

export type GrantAccess = "view" | "manage";

export interface DefaultRole {
  key: string;
  name: string;
  description: string;
  assignable: boolean;
  grants: Array<{ module: string; access: GrantAccess }>;
}

const manage = (modules: string[]) =>
  modules.map((module) => ({ module, access: "manage" as const }));
const view = (modules: string[]) =>
  modules.map((module) => ({ module, access: "view" as const }));

const ADMIN_MODULES = [
  "admin",
  "agents",
  "analytics",
  "apikeys",
  "catalog",
  "cms",
  "connections",
  "contacts",
  "contracts",
  "contribute",
  "demo",
  "events",
  "forms",
  "newsletters",
  "i18n",
  "invitations",
  "invoicing",
  "locations",
  "mail",
  "media",
  "platform",
  "quotes",
  "rentals",
  "roles",
  "scheduling",
  "seo",
  "settings",
  "webhooks",
];

export const DEFAULT_ROLES: readonly DefaultRole[] = [
  {
    key: "owner",
    name: "Owner",
    description: "The business owner. Full access, stored as an ordinary grant.",
    assignable: false,
    grants: manage(["*"]),
  },
  {
    key: "administrator",
    name: "Administrator",
    description: "Runs the instance and manages every currently installed area.",
    assignable: true,
    grants: manage(ADMIN_MODULES),
  },
  {
    key: "editor",
    name: "Editor",
    description: "Publishes the site, forms, media, translations, and SEO.",
    assignable: true,
    grants: [
      ...view(["admin", "analytics", "settings"]),
      ...manage(["cms", "forms", "i18n", "media", "seo"]),
    ],
  },
  {
    key: "bookkeeper",
    name: "Bookkeeper",
    description: "Manages invoicing and reads business, contact, activity, and reporting information.",
    assignable: true,
    grants: [
      ...view(["admin", "analytics", "contacts", "events", "settings"]),
      ...manage(["invoicing"]),
    ],
  },
  {
    key: "service-provider",
    name: "Service provider",
    description: "Works with customers and day-to-day service information.",
    assignable: true,
    grants: [
      ...view(["admin", "events", "forms", "locations", "media", "settings"]),
      // Somebody whose day is appointments needs the diary they appear in.
      ...manage(["contacts", "scheduling"]),
    ],
  },
  {
    key: "customer",
    name: "Customer",
    description: "Uses their own account and customer portal only.",
    assignable: true,
    grants: [],
  },
  {
    // N-1 may still write `staff` while a new image is rolling back. Keeping
    // the referenced row makes the additive migration readable and writable
    // by that image; new UI never offers it for assignment.
    key: "staff",
    name: "Legacy staff",
    description: "Compatibility role for accounts created before named roles.",
    assignable: false,
    grants: view(ADMIN_MODULES),
  },
] as const;

/** Seed missing defaults without overwriting an owner's later changes. */
export async function seedDefaultRoles(tx: Tx): Promise<void> {
  await tx
    .insert(roles)
    .values(
      DEFAULT_ROLES.map(({ grants: _grants, ...role }) => ({
        ...role,
        isSystem: true,
      })),
    )
    .onConflictDoNothing();

  const grants = DEFAULT_ROLES.flatMap((role) =>
    role.grants.map((grant) => ({ roleKey: role.key, ...grant })),
  );
  if (grants.length > 0) {
    await tx.insert(roleGrants).values(grants).onConflictDoNothing();
  }
}
