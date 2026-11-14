// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: keep the actual outer refund distinct from its acknowledgement.
import { sql } from "drizzle-orm";
import { merchantFeeObservations, merchantFeeRefunds } from "./merchant-collection-schema";

export function merchantFeeObservationMatchesRefund() {
  // A single-table selection strips Column qualifiers, including inside SQL
  // subqueries. Table + identifier chunks retain this necessary outer scope.
  return sql`exists(select 1 from ${merchantFeeObservations} a
    where a.operation_id=${merchantFeeRefunds}.${sql.identifier(merchantFeeRefunds.id.name)}
      and a.binding_verified
      and a.provider_ref=${merchantFeeRefunds}.${sql.identifier(merchantFeeRefunds.providerRef.name)}
      and a.amount_minor=${merchantFeeRefunds}.${sql.identifier(merchantFeeRefunds.amountMinor.name)}
      and a.currency=${merchantFeeRefunds}.${sql.identifier(merchantFeeRefunds.currency.name)}
      and a.application_fee_ref=${merchantFeeRefunds}.${sql.identifier(merchantFeeRefunds.applicationFeeRef.name)})`;
}
