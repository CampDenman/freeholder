// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// What My Account's navigation lists (C8.11, C3.39).
//
// Rooms with something in them come first, from the registry. The member
// network's pages and the shop's own pages follow only where the business
// uses them: a launched one-offer site turns them off, and a customer then
// sees their requests, messages, files, invoices, profile and privacy and
// nothing that business does not do.

export interface NavRoom { key: string; count: number }
export interface NavLink { path: string; labelKey: string }

const MEMBER_LINKS: NavLink[] = [
  { path: "/portal/member", labelKey: "portal.nav.member" },
  { path: "/portal/connections", labelKey: "portal.nav.connections" },
  { path: "/portal/listings", labelKey: "portal.nav.listings" },
  { path: "/portal/payouts", labelKey: "portal.nav.payouts" },
  { path: "/portal/sales", labelKey: "portal.nav.sales" },
];

export function portalNavLinks(rooms: readonly NavRoom[], areas: { members: boolean; shop: boolean }): NavLink[] {
  return [
    { path: "/portal", labelKey: "portal.nav.home" },
    ...rooms.filter((room) => room.count > 0).map((room) => ({ path: `/portal/${room.key}`, labelKey: `portal.room.${room.key}` })),
    ...(areas.shop ? [{ path: "/portal/registry", labelKey: "portal.nav.registry" }] : []),
    ...(areas.members ? MEMBER_LINKS.slice(0, 2) : []),
    { path: "/portal/notifications", labelKey: "portal.nav.notifications" },
    ...(areas.members ? MEMBER_LINKS.slice(2) : []),
    ...(areas.shop ? [{ path: "/portal/purchases", labelKey: "portal.nav.purchases" }] : []),
    { path: "/portal/profile", labelKey: "portal.nav.profile" },
    { path: "/portal/privacy", labelKey: "portal.nav.privacy" },
  ];
}
