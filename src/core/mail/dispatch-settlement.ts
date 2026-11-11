// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C3.31/C11.08: no missing or unresolved physical attempt is a final outcome.
import { inArray, sql } from "drizzle-orm";
import { mailDeliveries, mailDispatches, mailDispatchRequests, mailLegacyResolutions } from "./schema";

export const physicallySettledMail = sql`(
 (exists(select 1 from ${mailDispatchRequests} where ${mailDispatchRequests.deliveryId}=${mailDeliveries.id})
  and ${mailDeliveries.attempts}>0
  and (select count(*) from ${mailDispatches} where ${mailDispatches.deliveryId}=${mailDeliveries.id})=${mailDeliveries.attempts}
  and not exists(select 1 from ${mailDispatches} where ${mailDispatches.deliveryId}=${mailDeliveries.id} and ${inArray(mailDispatches.state, ["running", "unknown"])}) )
 or (exists(select 1 from ${mailLegacyResolutions} where ${mailLegacyResolutions.deliveryId}=${mailDeliveries.id})
  and not exists(select 1 from ${mailDispatchRequests} where ${mailDispatchRequests.deliveryId}=${mailDeliveries.id})
  and not exists(select 1 from ${mailDispatches} where ${mailDispatches.deliveryId}=${mailDeliveries.id}))
)`;
