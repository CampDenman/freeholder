// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: purpose child never changes an old reservation's full-row hash.
import {sql} from "drizzle-orm";
import {check,foreignKey,index,jsonb,pgTable,text,uuid} from "drizzle-orm/pg-core";
import {createdAtColumn} from "@/core/db/columns";
import {payments} from "./schema";
import {invoiceCreditApplications,invoiceCreditReservations} from "./credit-application-schema";
import {invoiceCreditFundingAtomicFeePartitions} from "./atomic-credit-fee-partition-schema";
import type {AtomicCreditFeeCurrentEntry} from "./atomic-credit-fee-partition-contract";
import type {AtomicCreditReservationEconomics} from "./atomic-credit-reservation-contract";
export const invoiceCreditReservationAtomicFeePartitions=pgTable("invoice_credit_reservation_atomic_fee_partitions",{
 reservationId:uuid("reservation_id").primaryKey(),fundingId:uuid("funding_id").notNull(),rootFundingId:uuid("root_funding_id").notNull(),sourcePaymentId:uuid("source_payment_id").notNull(),sourceApplicationId:uuid("source_application_id"),
 protocol:text("protocol").notNull(),parentFingerprint:text("parent_fingerprint").notNull(),fundingPartitionFingerprint:text("funding_partition_fingerprint").notNull(),economics:jsonb("economics").$type<AtomicCreditReservationEconomics>().notNull(),
 beforeEntries:jsonb("before_entries").$type<AtomicCreditFeeCurrentEntry[]>().notNull(),admissionTransactionId:text("admission_transaction_id").notNull(),digest:text("digest").notNull(),authentication:text("authentication").notNull(),createdAt:createdAtColumn(),
},t=>[
 foreignKey({name:"credit_atomic_reservation_parent_fk",columns:[t.reservationId],foreignColumns:[invoiceCreditReservations.id]}).onDelete("restrict"),
 foreignKey({name:"credit_atomic_reservation_funding_fk",columns:[t.fundingId],foreignColumns:[invoiceCreditFundingAtomicFeePartitions.fundingId]}).onDelete("restrict"),
 foreignKey({name:"credit_atomic_reservation_root_fk",columns:[t.rootFundingId],foreignColumns:[invoiceCreditFundingAtomicFeePartitions.fundingId]}).onDelete("restrict"),
 foreignKey({name:"credit_atomic_reservation_payment_fk",columns:[t.sourcePaymentId],foreignColumns:[payments.id]}).onDelete("restrict"),
 foreignKey({name:"credit_atomic_reservation_application_fk",columns:[t.sourceApplicationId],foreignColumns:[invoiceCreditApplications.reservationId]}).onDelete("restrict"),
 index("credit_atomic_reservation_funding").on(t.fundingId,t.reservationId),index("credit_atomic_reservation_root").on(t.sourcePaymentId,t.rootFundingId,t.reservationId),index("credit_atomic_reservation_application").on(t.sourceApplicationId,t.reservationId),
 check("credit_atomic_reservation_protocol",sql`${t.protocol}='freeholder.atomic-credit-fee-reservation.v1' and ${t.admissionTransactionId} ~ '^[0-9]+$'`),
 check("credit_atomic_reservation_fingerprints",sql`${t.parentFingerprint} ~ '^[a-f0-9]{64}$' and ${t.fundingPartitionFingerprint} ~ '^[a-f0-9]{64}$' and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.authentication} ~ '^[a-f0-9]{64}$'`),
 check("credit_atomic_reservation_economics",sql`(jsonb_typeof(${t.economics})='object' and ${t.economics}->>'protocol'='freeholder.atomic-credit-fee-reservation.v1' and jsonb_typeof(${t.economics}->'segments')='array'
  and jsonb_array_length(${t.economics}->'segments') between 1 and 5000 and (${t.economics}->>'originalPrincipalMinor')::numeric between 1 and 9007199254740991
  and (${t.economics}->>'originalFeeMinor')::numeric between 0 and (${t.economics}->>'originalPrincipalMinor')::numeric
  and (${t.economics}->>'amountMinor')::numeric between 1 and (${t.economics}->>'originalPrincipalMinor')::numeric
  and (${t.economics}->>'nominalFeeMinor')::numeric=(${t.economics}->>'retiredFeeMinor')::numeric+(${t.economics}->>'assignedFeeMinor')::numeric
  and (${t.economics}->>'assignedFeeMinor')::numeric=(${t.economics}->>'provenCollectedMinor')::numeric+(${t.economics}->>'owedFeeMinor')::numeric) is true`),
 check("credit_atomic_reservation_before_entries",sql`jsonb_typeof(${t.beforeEntries})='array' and jsonb_array_length(${t.beforeEntries})<=5000`),
]);
