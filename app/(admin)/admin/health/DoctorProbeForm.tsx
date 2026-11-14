// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import {useActionState} from "react";
import {Button,Callout} from "@/ui/primitives";
import {runDoctorProbeAction,type DoctorProbeState} from "./actions";
type Labels={run:string;running:string;hint:string;at:string;ok:string;warn:string;fail:string};
export function DoctorProbeForm({labels}:{labels:Labels}){
 const[state,action,pending]=useActionState<DoctorProbeState,FormData>(runDoctorProbeAction,{});
 return <div className="grid gap-3"><form action={action} className="grid gap-2"><p className="text-sm text-ink-muted">{labels.hint}</p><div><Button type="submit" disabled={pending}>{pending?labels.running:labels.run}</Button></div></form>
  {state.error?<Callout tone="danger">{state.error}</Callout>:null}
  {state.report?<div className="grid gap-3"><Callout tone={state.report.verdict==="ok"?"success":state.report.verdict==="fail"?"danger":"warning"}>{labels[state.report.verdict]}</Callout><p className="text-sm text-ink-muted">{labels.at}: <time dateTime={state.report.ranAt}>{state.report.ranAt}</time></p><ul className="grid gap-2">{state.report.checks.map(check=><li key={check.id} className="text-sm"><span className="font-semibold">{check.title}</span>: {check.detail}{check.remedy?<p className="text-ink-muted">{check.remedy}</p>:null}</li>)}</ul></div>:null}
 </div>;
}
