// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.10/C12.38: only module roots compose recovery service bundles.
import quiescenceServices from "./merchant-tax-quiescence";
import scheduleCallerServices from "./provider-schedule-callers";
import scheduleErasureServices from "./provider-schedule-erasure";
import buyerErasureServices from "./buyer-agreement-erasure";
import phaseProductServices from "./provider-phase-product-services";
import phaseDispatchServices from "./provider-phase-dispatch";
import phaseStopServices from "./provider-phase-stop";
import scheduleReadServices from "./provider-schedule-recovery";
import invoiceStopServices from "./provider-invoice-actions";
import amendmentActivationServices from "./commercial-amendment-jobs";

export default [
  ...quiescenceServices,
  ...scheduleCallerServices,
  ...scheduleErasureServices,
  ...buyerErasureServices,
  ...phaseProductServices,
  ...phaseDispatchServices,
  ...phaseStopServices,
  ...scheduleReadServices,
  ...invoiceStopServices,
  ...amendmentActivationServices,
];
