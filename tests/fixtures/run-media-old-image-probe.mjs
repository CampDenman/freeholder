// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
import {startVitest} from "vitest/node";
const fixture="tests/fixtures/media-old-image.probe.ts";
const runner=await startVitest([fixture],{config:"vitest.config.ts",run:true,watch:false},{test:{include:[fixture]}});
try{const files=runner.state.getFiles();if(files.length!==1||files[0].result?.state!=="pass")process.exitCode=1;}finally{await runner.close();}
