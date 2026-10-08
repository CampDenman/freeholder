// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer's own bookings, in the portal (MASTER.md §43 C8.11).
//
// Bookings live in core rather than a module, so this registers from core —
// which is allowed in the direction that matters: core is not importing a
// module, it is one part of core telling another what it can show.
//
// The service is the one admin already uses, filtered to the signed-in
// customer's own contact. C8.11 asks for exactly that: a second audience for
// a query, never a second implementation of it.
import { formatMoney, translator } from "@/core/i18n";
import { contacts } from "@/core/contacts/schema";
import { storedOutcome, termsFrom } from "./policy";
import { registerPortalSection } from "@/core/portal/sections";
import { and, eq } from "drizzle-orm";
import { bookings } from "./schema";
import { ServiceError } from "@/core/service";
import { listBookings, getBooking, cancelByToken } from "./bookings";

registerPortalSection({
  key: "bookings",
  order: 40,
  detail: async (ctx, contactId, id) => {
    const booking = await ctx.callAsSystem(getBooking, { id });
    if (!booking || booking.contactId !== contactId) throw new ServiceError("not_found", "That appointment is unavailable.");
    const [contact] = await ctx.tx.select({locale:contacts.preferredLocale}).from(contacts).where(eq(contacts.id,contactId)).limit(1);
    const t = translator(contact?.locale ?? "en");
    const policy = termsFrom(booking.cancellationPolicy);
    const outcome = storedOutcome.safeParse(booking.cancellationOutcome);
    const cancellation = outcome.success && outcome.data.currency ? [{labelKey:"portal.record.cancellationFee",value:formatMoney(outcome.data.feeMinor,outcome.data.currency,contact?.locale??"en")},{labelKey:"portal.record.refundDue",value:formatMoney(outcome.data.refundDueMinor,outcome.data.currency,contact?.locale??"en")}] : [];
    return { fields: [...cancellation, {labelKey:"publicBooking.policy",value:`${policy.name}\n${t("publicBooking.freeUntil",{hours:policy.freeUntilHours})}\n${t("publicBooking.rescheduleLimit",{count:policy.rescheduleLimit})}`}, { labelKey: "portal.record.ends", value: booking.endsAt.toISOString() }, { labelKey: "portal.record.timezone", value: booking.timezoneAtBooking }], links: [...(booking.invoiceId ? [{labelKey:"portal.record.invoice",href:`/portal/invoices/${booking.invoiceId}`}] : []), ...(["requested","confirmed"].includes(booking.status) && booking.serviceOfferingId ? [{labelKey:"portal.record.reschedule",href:`/book?move=${booking.id}`}] : [])], actions: ["requested","confirmed","in_progress"].includes(booking.status) ? ["cancel" as const] : [] };
  },
  act: async (ctx, contactId, id, input) => {
    const [booking] = await ctx.tx.select().from(bookings).where(and(eq(bookings.id,id),eq(bookings.contactId,contactId))).limit(1);
    if (!booking?.rescheduleToken || input.action !== "cancel") throw new ServiceError("not_found", "That appointment is unavailable.");
    await ctx.call(cancelByToken, {token:booking.rescheduleToken, reason:input.reason || "Cancelled by the customer."});
    return {};
  },
  load: async (ctx, contactId, limit) => {
    const rows = await ctx.call(listBookings, { contactId, limit });
    return rows.map((booking) => ({
      id: booking.id,
      title: booking.calendarName,
      status: booking.status,
      at: booking.startsAt ?? null,
      href: `/portal/records/bookings/${booking.id}`,
    }));
  },
});
