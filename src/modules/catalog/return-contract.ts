// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared return contracts (C5.19).
import {z} from "zod";
import {listed,row,timestamp,uuid} from "@/core/contract";
import {RETURN_STATUSES} from "./contract";
export const returnRequestRow = row({
  id: uuid,
  orderId: uuid,
  contactId: uuid,
  status: z.enum(RETURN_STATUSES),
  reason: z.string(),
  restock: z.boolean(),
  labelUrl: z.string().nullable(),
  creditNoteId: uuid.nullable(),
  refundId: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const returnItemRow = row({
  id: uuid,
  returnId: uuid,
  orderItemId: uuid,
  quantity: z.number().int(),
  restockedQuantity: z.number().int(),
  createdAt: timestamp,
});
export const returnDetail = z.object({
  return: returnRequestRow,
  items: listed(returnItemRow),
});
