// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import {existsSync} from 'node:fs';
import {createVitest} from 'vitest/node';
const database=process.env.TEST_DATABASE_URL;
if(!database||new URL(database).hostname!=='127.0.0.1'||new URL(database).pathname!=='/freeholder_crawl81_index_leak_review_work_test_20261112')throw new Error('Only the explicitly NEW disposable work clone is allowed.');
if(existsSync('.env'))throw new Error('Historical review refuses environment-file fallback; use its explicit work-clone URL.');
// Match the normal Vitest launcher environment, without starting its tests.
process.env.TEST='true';process.env.VITEST='true';process.env.NODE_ENV??='test';
const fixture='tests/fixtures/crawl-history-review.probe.ts';
const runner=await createVitest({config:'vitest.config.ts',run:true,watch:false,bail:1,globalSetup:[]},{test:{include:[fixture],globalSetup:[]}});
try{
 if(runner.config.globalSetup.length||runner.projects.some(project=>project.config.globalSetup.length))throw new Error('Historical review requires resolved globalSetup=[] before any test runs.');
 console.log('Resolved historical globalSetup=[]; no reset or migrator is invoked.');
 await runner.start([fixture]);
 const files=runner.state.getFiles();if(files.length!==1||files[0].result?.state!=='pass')process.exitCode=1;
}finally{await runner.close();}
