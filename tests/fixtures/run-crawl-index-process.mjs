// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import {existsSync} from 'node:fs';
import {createVitest} from 'vitest/node';
const database=process.env.TEST_DATABASE_URL;
if(!database||!['127.0.0.1','localhost'].includes(new URL(database).hostname)||!/^\/freeholder_[a-z0-9_]*test[a-z0-9_]*$/.test(new URL(database).pathname))throw new Error('An explicit parent-owned local disposable database is required.');
if(process.env.FREEHOLDER_CRAWL_INDEX_NO_MIGRATE!=='1'||!['prefix500','finish501'].includes(process.env.FREEHOLDER_CRAWL_INDEX_PHASE))throw new Error('Only the declared persisted index phase is allowed.');
if(existsSync('.env'))throw new Error('A separate indexer refuses environment-file fallback.');
process.env.TEST='true';process.env.VITEST='true';process.env.NODE_ENV='test';
const fixture='tests/fixtures/crawl-index-process.probe.ts';
const runner=await createVitest({config:'vitest.config.ts',run:true,watch:false,bail:1,globalSetup:[]},{test:{include:[fixture],globalSetup:[]}});
try {
  if(runner.config.globalSetup.length||runner.projects.some(project=>project.config.globalSetup.length))throw new Error('Resolved globalSetup must be empty: no migrator, reset or seed may run in the separate indexer.');
  await runner.start([fixture]);
  const files=runner.state.getFiles();if(files.length!==1||files[0].result?.state!=='pass')process.exitCode=1;
} finally {await runner.close();}
