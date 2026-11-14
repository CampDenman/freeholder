// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38: recover genuine created fixture resources without changing old oracles.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import manifest from "../../deploy/atomic-auxiliary-specific-get-fixture-root-continuation.manifest.json";
const read=(path:string)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
it("keeps every original HTTP bank branch and whole 180s native unchanged",()=>{
 const actual=read(manifest.source);
 expect(hash(actual)).toBe(manifest.afterSha256);
 expect(actual.split(manifest.finiteDelta.after)).toHaveLength(2);
 expect(actual.replace(manifest.finiteDelta.after,()=>manifest.finiteDelta.before)).toBe(manifest.beforeWholeFile);
 expect(hash(manifest.beforeWholeFile)).toBe(manifest.beforeSha256);
 for(const [path,digest] of Object.entries(manifest.preservedOriginalNatives)){
  const source=read(path);expect(hash(source)).toBe(digest);expect(source).toContain("timeout:180000");
 }
});
