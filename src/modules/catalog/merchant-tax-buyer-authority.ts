// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C11.10: public preview access does not grant private buyer pricing.
import {permits,type Actor} from "@/core/service";
export function canReadNamedBuyerTax(actor:Actor):boolean{
 return permits(actor,"scoped","catalog.resolvePrice","query");
}
