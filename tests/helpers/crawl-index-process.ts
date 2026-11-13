// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C3.47: a second indexer receives persisted IDs, never producer/parser memory.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execute=promisify(execFile);
export async function runCrawlIndexProcess(id:string,generation:string,userId:string,phase:"prefix500"|"finish501") {
  const database=process.env.DATABASE_URL;
  if(!database||!["127.0.0.1","localhost"].includes(new URL(database).hostname)||!/^\/freeholder_[a-z0-9_]*test[a-z0-9_]*$/.test(new URL(database).pathname))throw new Error("A crawl index process requires the parent's explicitly named local disposable database.");
  for(const value of [id,generation,userId])z.uuid().parse(value);
  const directory=await mkdtemp(join(tmpdir(),"freeholder-crawl-index-process-")),output=join(directory,"result.json");
  try {
    const result=await execute(process.execPath,["tests/fixtures/run-crawl-index-process.mjs"],{cwd:process.cwd(),timeout:60_000,maxBuffer:1_048_576,env:{
      PATH:process.env.PATH,NODE_ENV:"test",TEST_DATABASE_URL:database,
      SESSION_SECRET:process.env.SESSION_SECRET??"vitest-deterministic-session-secret-key-32+",
      CREDENTIAL_KEY:process.env.CREDENTIAL_KEY??"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      FREEHOLDER_STORAGE:"local",LOCAL_STORAGE_ROOT:process.env.LOCAL_STORAGE_ROOT??resolve(".data/media"),FREEHOLDER_JOBS:"off",
      FREEHOLDER_CRAWL_INDEX_NO_MIGRATE:"1",FREEHOLDER_CRAWL_INDEX_RUN_ID:id,FREEHOLDER_CRAWL_INDEX_GENERATION:generation,FREEHOLDER_CRAWL_INDEX_USER_ID:userId,
      FREEHOLDER_CRAWL_INDEX_PHASE:phase,FREEHOLDER_CRAWL_INDEX_OUTPUT:output,
    }});
    await writeFile(join(directory,"stdout.log"),result.stdout,{flag:"wx",mode:0o600});
    await writeFile(join(directory,"stderr.log"),result.stderr,{flag:"wx",mode:0o600});
    const evidence=z.object({pid:z.number().int().positive(),runId:z.uuid(),generation:z.uuid(),sessionId:z.uuid(),beforeIndexed:z.number().int().nonnegative(),indexed:z.number().int().nonnegative(),planReady:z.boolean(),steps:z.array(z.string()),journalUnchanged:z.literal(true),transportCalls:z.literal(0)}).parse(JSON.parse(await readFile(output,"utf8")));
    return {...evidence,directory};
  } catch(error) {
    const failure=error as {stdout?:unknown;stderr?:unknown};
    if(typeof failure.stdout==="string")await writeFile(join(directory,"stdout.log"),failure.stdout,{flag:"wx",mode:0o600});
    if(typeof failure.stderr==="string")await writeFile(join(directory,"stderr.log"),failure.stderr,{flag:"wx",mode:0o600});
    // The first failing child's output/evidence directory is preserved.
    throw new Error(`The separate crawl index process failed; preserve ${directory} for review.`,{cause:error});
  }
}
