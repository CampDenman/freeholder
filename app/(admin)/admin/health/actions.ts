// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import {doctor} from "@/core/doctor/service";
import {ServiceError} from "@/core/service";
import {getT} from "../../../i18n";
import {requireStaffActor} from "../guard";
import {localized} from "./report-labels";
export type DoctorProbeState={report?:Awaited<ReturnType<typeof doctor.call>>;error?:string};
export async function runDoctorProbeAction(_previous:DoctorProbeState,_form:FormData):Promise<DoctorProbeState>{
 const actor=await requireStaffActor("platform","manage"),t=await getT();
 try{const report=await doctor.call({},actor);return{report:{...report,checks:report.checks.map(check=>localized(check,t))}};}
 catch(error){return{error:error instanceof ServiceError?error.message:t("doctor.probe.failed")};}
}
