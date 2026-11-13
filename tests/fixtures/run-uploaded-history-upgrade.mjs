// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C1.08/C3.47/C11.14: opt-in NEW DB, actual old79 runtime -> ordinary81.
// Never clones/resets/drops a database or reads an existing failure/golden DB.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {migrate} from 'drizzle-orm/postgres-js/migrator';
const source=fileURLToPath(new URL('../..',import.meta.url));
const database=process.env.FREEHOLDER_HISTORY_UPGRADE_DATABASE;
const oldSource=process.env.FREEHOLDER_HISTORY_BEFORE_SOURCE;
const expectedHead=process.env.FREEHOLDER_HISTORY_EXPECTED_HEAD;
const output=process.env.FREEHOLDER_HISTORY_OUTPUT;
assert(database&&/^freeholder_uploaded_history_upgrade_v[1-9]\d*_test_\d{8}$/.test(database));
assert(oldSource&&path.isAbsolute(oldSource)&&output&&path.resolve(output).startsWith('/tmp/'));
assert(expectedHead&&/^[a-f0-9]{40}$/.test(expectedHead));
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
assert.equal(git(source,['rev-parse','HEAD']),expectedHead);assert.equal(git(source,['diff','--name-only','HEAD']),'');
assert.equal(git(oldSource,['rev-parse','HEAD']),'f1b5d6a3ff80ffdd32e8a1d23f7e629909b673b4');
assert.equal(git(oldSource,['hash-object','tests/core/import-wxr-index-erasure.test.ts']),'4a470c3489a62f3a1e41ec3ee8e9c7fa222ab89d');
for(const root of [source,oldSource])for(const file of ['.env','.env.local'])await assert.rejects(fs.access(path.join(root,file)),{code:'ENOENT'});
await fs.mkdir(output,{mode:0o700});const media=path.join(output,'private-media');await fs.mkdir(media,{mode:0o700});
const digest=value=>createHash('sha256').update(value).digest('hex');
const journal=JSON.parse(await fs.readFile(path.join(source,'db/migrations/meta/_journal.json'),'utf8')).entries;
const oldJournal=JSON.parse(await fs.readFile(path.join(oldSource,'db/migrations/meta/_journal.json'),'utf8')).entries;
assert.equal(journal.length,82);assert.equal(oldJournal.length,80);assert.deepEqual(journal.slice(0,80),oldJournal);
const identities=[];for(const entry of journal){const bytes=await fs.readFile(path.join(source,'db/migrations',entry.tag+'.sql'));if(entry.idx<80)assert.deepEqual(bytes,await fs.readFile(path.join(oldSource,'db/migrations',entry.tag+'.sql')));identities.push({when:String(entry.when),hash:digest(bytes)});}
assert.equal(identities[81].hash,'955a04d2f7834f11af33e6b41b1a3f1ab6d342d0d9ca78732b77d2f5ff3b5cee');
const connect=name=>postgres(`postgres://postgres@127.0.0.1:55447/${name}`,{max:1,onnotice:()=>{},connection:{TimeZone:'UTC',options:'-c jit=off -c lock_timeout=10000 -c statement_timeout=25000'}});
const admin=connect('postgres');const report={database,source,expectedHead,oldSource,output,created:false,passed:false,stages:[],scope:'Actual populated synthetic old79->81 recovery; no full-row export/clone or old failure DB use.'};
const save=async()=>fs.writeFile(path.join(output,'execution.json'),JSON.stringify(report,null,2)+'\n');
const run=async(cwd,file,label,extra={})=>{
 const env=Object.fromEntries(['PATH','HOME','LANG','LC_ALL','TMPDIR'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
 Object.assign(env,{NODE_ENV:'test',TEST_DATABASE_URL:`postgres://postgres@127.0.0.1:55447/${database}`,FREEHOLDER_STORAGE:'local',LOCAL_STORAGE_ROOT:media,FREEHOLDER_JOBS:'off',PGOPTIONS:'-c timezone=UTC -c jit=off'},extra);
 const log=await fs.open(path.join(output,label+'.log'),'wx');const start=Date.now();
 try{return await new Promise((resolve,reject)=>{let timedOut=false;const child=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run',file,'--bail=1','--retry=0','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile='+path.join(output,label+'.json')],{cwd,env,detached:true,stdio:['ignore',log.fd,log.fd]});const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGTERM');}catch{}},150_000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);report.stages.push({label,exitCode:code,timedOut,seconds:(Date.now()-start)/1000});if(timedOut)reject(new Error(label+' exceeded the external150s fixture bound; preserved state, child group exited'));else resolve(code);});});}finally{await log.close();await save();}
};
try{
 assert.equal((await admin`select datname from pg_database where datname=${database}`).length,0,'NEW database must be absent; never replace a prior fixture');
 await admin.unsafe(`create database "${database}"`);report.created=true;await save();
 let sql=connect(database);try{await migrate(drizzle(sql),{migrationsFolder:path.join(oldSource,'db/migrations')});assert.deepEqual((await sql`select created_at::text stamp,hash from drizzle.__drizzle_migrations order by created_at,id`).map(row=>({when:row.stamp,hash:row.hash})),identities.slice(0,80));}finally{await sql.end();}
 assert.equal(await run(oldSource,'tests/core/import-wxr-index-erasure.test.ts','old79-original-f1'),1,'The unchanged old runtime must genuinely reproduce false completed private-index erasure');
 assert.equal((await admin`select pid from pg_stat_activity where datname=${database}`).length,0);
 sql=connect(database);let before;try{
 const [request]=await sql`select request.id,request.status,request.verified_at is not null verified,outcome->>'outcome' outcome from data_requests request join data_request_artifacts artifact on artifact.data_request_id=request.id cross join lateral jsonb_array_elements(artifact.body->'outcomes') outcome where outcome->>'scope'='imports.readerSources'`;
 assert.equal(request.status,'completed');assert(request.verified);assert.equal(request.outcome,'erased');
 const [graph]=await sql`select graph.id,graph.run_id,(select count(*)::int from import_source_entries entry where entry.graph_id=graph.id) entries,(select count(*)::int from import_source_entries entry where entry.graph_id=graph.id and entry.metadata::text like '%private-wxr-index-reader@example.test%') marked_entries from import_source_graphs graph`;
 assert.equal(graph.entries,501);assert.equal(graph.marked_entries,1);
 const [original]=await sql`select id,data from pgboss.job where name='core.eraseImportSourceObjects' and data->>'requestId'=${request.id}`;assert(original&&original.id===original.data.originalJobId);
 for(const key of original.data.keys){assert.match(key,/^imports\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/\d{5}\.part$/);await assert.rejects(fs.stat(path.join(media,key)),{code:'ENOENT'});}
 const physical=await sql`select operation_kind,state,count(*)::int count from media_object_writes group by operation_kind,state order by operation_kind`;assert.deepEqual(physical.map(row=>({...row})),[{operation_kind:'delete',state:'accepted',count:1},{operation_kind:'put',state:'accepted',count:1}]);
 before={database,requestId:request.id,originalJobId:original.id,runId:graph.run_id,graphId:graph.id,ownerId:'00000000-0000-4000-8000-000000000001',originalTaskDigest:digest(JSON.stringify(original.data)),marker:'private-wxr-index-reader@example.test',old79JournalEntries:80,entries:graph.entries,markedEntries:graph.marked_entries,rawAbsent:true,physical};
 await fs.writeFile(path.join(output,'before.json'),JSON.stringify(before,null,2)+'\n',{flag:'wx'});
 // No standalone SQL fragment: normal migrator appends the exact80+81 journal.
 await migrate(drizzle(sql),{migrationsFolder:path.join(source,'db/migrations')});assert.deepEqual((await sql`select created_at::text stamp,hash from drizzle.__drizzle_migrations order by created_at,id`).map(row=>({when:row.stamp,hash:row.hash})),identities);
 assert.equal((await sql`select 1 from import_source_erasure_scopes`).length,0);assert.equal((await sql`select 1 from import_source_erasure_members`).length,0);assert.equal((await sql`select 1 from import_source_erasure_objects`).length,0);
 }finally{await sql.end();}
 assert.equal(await run(source,'tests/core/import-uploaded-history-upgrade.test.ts','current81-recovery',{FREEHOLDER_UPLOADED_HISTORY_UPGRADE:database,FREEHOLDER_UPLOADED_HISTORY_EVIDENCE:path.join(output,'before.json')}),0);
 sql=connect(database);try{
 const [request]=await sql`select status,fulfilled_at is null unfulfilled,resolution is not null recovery_note from data_requests where id=${before.requestId}`;assert.equal(request.status,'in_progress');assert(request.unfulfilled&&request.recovery_note);
 const counts=await sql`select (select count(*)::int from import_source_erasure_scopes) scopes,(select count(*)::int from import_source_erasure_members) members,(select count(*)::int from import_source_erasure_objects) objects`;assert.deepEqual([...counts],[{scopes:0,members:0,objects:0}]);report.final={request,counts:[...counts],journalEntries:(await sql`select 1 from drizzle.__drizzle_migrations`).length};
 }finally{await sql.end();}
 report.passed=true;
}catch(error){report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 report.active=report.created?await admin`select pid,state from pg_stat_activity where datname=${database}`:[];if(report.active.length){report.passed=false;process.exitCode=1;}await admin.end();await save();console.log(JSON.stringify(report));
}
