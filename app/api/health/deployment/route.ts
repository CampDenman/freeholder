// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// This is a deployment boot/schema probe, never ordinary job/call readiness.
import {ready} from '@/core/runtime';
import {probeSchema} from '@/core/runtime/schema-probe';
import {readDeploymentHold} from '@/core/runtime/deployment-admission';
export const dynamic='force-dynamic';
export async function GET():Promise<Response>{
  try{
    const [report,schema,hold]=await Promise.all([ready(),probeSchema(),readDeploymentHold()]);
    const ok=report.disabled.length===0 && schema==='ok' && hold!==null;
    return Response.json({ok,version:'freeholder-deployment-admission-v1',held:hold!==null,normalJobReadiness:false},{status:ok?200:503,headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({ok:false,normalJobReadiness:false},{status:503,headers:{'Cache-Control':'no-store'}});}
}
