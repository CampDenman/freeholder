// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import {startVitest} from 'vitest/node';
const database=process.env.TEST_DATABASE_URL;
if(!database||new URL(database).hostname!=='127.0.0.1'||new URL(database).pathname!=='/freeholder_crawl81_current_terms_syntax_test_20261112_v7')throw new Error('Only the unchanged real old-empty v7 fixture is admissible.');
const fixture='tests/fixtures/crawl-current-empty.probe.ts';
const runner=await startVitest([fixture],{config:'vitest.config.ts',run:true,watch:false,bail:1},{test:{include:[fixture]}});
try{const files=runner.state.getFiles();if(files.length!==1||files[0].result?.state!=='pass')process.exitCode=1;}finally{await runner.close();}
