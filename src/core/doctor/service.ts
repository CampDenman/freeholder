// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Doctor as a service (MASTER.md §17, §2 principle 7).
//
// One implementation, four doors: the admin screen, the REST API, MCP, and
// whatever a recipe's CI calls. The alternative — a script that reimplements
// the checks so it can run without the app — is how the script and the product
// come to disagree about what "healthy" means.
import { z } from "zod";
import { defineService,defineOrchestratedService } from "@/core/service";
import { runDoctor,readDoctorStatus } from "@/core/doctor";
import { listed, row } from "@/core/contract";

const doctorCheck = row({
  id: z.string(),
  title: z.string(),
  verdict: z.enum(["ok", "warn", "fail"]),
  detail: z.string(),
  remedy: z.string().optional(),
  /** A catalog key and its values, for screens that show the check in the owner's language. */
  message: z
    .object({ key: z.string(), params: z.record(z.string(), z.string()) })
    .optional(),
});
const doctorReport = z.object({
  verdict: z.enum(["ok", "warn", "fail"]),
  checks: listed(doctorCheck),
  ranAt: z.string(),
});

/**
 * Owner-only.
 *
 * The report names which adapters are configured and how they are failing,
 * which is exactly the reconnaissance somebody probing an instance would like.
 * `/api/health` stays public and stays shallow for the same reason.
 */
export const doctor = defineOrchestratedService({
  name: "platform.probeDoctor",
  summary: "Check this instance's configuration and adapters.",
  // The real storage round trip creates/removes a diagnostic file.
  // It is neither read-only nor allowed inside another service transaction.
  kind: "mutation",
  writeClass:"write",
  permission: "scoped",
  input: z.object({}),
  output: doctorReport,
  handler:async(_input,actor)=>{
    await beginProbe.call({},actor);
    const report=await runDoctor(actor);
    await finishProbe.call({verdict:report.verdict,checks:report.checks.length},actor);
    return report;
  },
});

const beginProbe=defineService({name:"platform.authorizeDoctorProbe",summary:"Audit an explicitly authorized diagnostic probe before physical work.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"platform.probeDoctor",writeClass:"write",input:z.object({}),output:z.object({ok:z.literal(true)}),handler:async(_input,ctx)=>{ctx.setSubject("platform","doctor");return{ok:true as const};}});
const finishProbe=defineService({name:"platform.recordDoctorProbe",summary:"Audit completion of the actual diagnostic probe without retaining credentials or provider bodies.",kind:"mutation",permission:"scoped",external:false,orchestratedBy:"platform.probeDoctor",writeClass:"write",input:z.object({verdict:z.enum(["ok","warn","fail"]),checks:z.number().int().nonnegative()}),output:z.object({ok:z.literal(true)}),auditInputFields:["verdict","checks"],handler:async(input,ctx)=>{ctx.setSubject("platform","doctor");ctx.queueEvent("platform.diagnosed",input);return{ok:true as const};}});
/** The old read scope remains read-only; it never acquires new write rights. */
export const doctorStatus=defineService({name:"platform.doctor",summary:"Read passive configuration diagnostics without writing files or contacting providers.",kind:"query",permission:"scoped",input:z.object({}),output:doctorReport,handler:()=>readDoctorStatus()});
export default [doctorStatus,doctor,beginProbe,finishProbe];
