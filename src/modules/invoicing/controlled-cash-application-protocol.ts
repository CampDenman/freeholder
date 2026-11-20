// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: application versions are independent of the accepted bank target.
export const CONTROLLED_CASH_LEGACY_PROTOCOL="controlled_net_gross.v1";
export const CONTROLLED_CASH_ATOMIC_PROTOCOL="controlled_cash_atomic.v1";
export function isControlledCashApplicationProtocol(value:string){return value===CONTROLLED_CASH_LEGACY_PROTOCOL||value===CONTROLLED_CASH_ATOMIC_PROTOCOL;}
