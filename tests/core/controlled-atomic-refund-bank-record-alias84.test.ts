// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// PREPARED/UNRUN: full source reversals do not execute a PostgreSQL function.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const read=(path:string)=>readFileSync(path,"utf8"),hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const manifest=JSON.parse(read("deploy/controlled-atomic-refund-bank-record-alias84.manifest.json")) as {predecessorOwnedTail:{file:string;bytes:number;sha256:string};tail:{bytes:number;sha256:string};successors:{signature:string;beforeStatement:string;beforeBodySha256:string;afterBodySha256:string;replacements:{before:string;after:string;count:number}[]}[]};
const source=read("deploy/controlled-atomic-refund-bank-record-alias84.fragment.sql");
function statement(signature:string){const name=signature.slice(0,signature.indexOf("(")),start=source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`),end=source.indexOf("$$;",start);if(start<0||end<start)throw new Error("Missing exact complete successor");return source.slice(start,end+3);}
function body(value:string){const start=value.indexOf("AS $$"),end=value.lastIndexOf("$$;");if(start<0||end<start)throw new Error("Missing exact function body");return value.slice(start+5,end);}
describe("bank record alias exact full successor",()=>{
 it("reverses each sole edit to its entire frozen predecessor body",()=>{for(const successor of manifest.successors){let rewound=statement(successor.signature);expect(hash(body(rewound))).toBe(successor.afterBodySha256);for(const edit of [...successor.replacements].reverse()){expect(rewound.split(edit.after).length-1).toBe(edit.count);rewound=rewound.replace(edit.after,()=>edit.before);}expect(rewound).toBe(successor.beforeStatement);expect(hash(body(rewound))).toBe(successor.beforeBodySha256);}});
 it("keeps frozen dd3 exact and records actual full new tail identity",()=>{const old=read(manifest.predecessorOwnedTail.file);expect(Buffer.byteLength(old)).toBe(manifest.predecessorOwnedTail.bytes);expect(hash(old)).toBe(manifest.predecessorOwnedTail.sha256);expect(Buffer.byteLength(source)).toBe(manifest.tail.bytes);expect(hash(source)).toBe(manifest.tail.sha256);expect(source).toContain("actual_refund refunds%ROWTYPE");expect(source).not.toContain("jsonb_array_elements(bank->'refunds') actual_refund WHERE actual_refund=prior_refund");expect(source).toContain("jsonb_array_elements(bank->'refunds') current_refund_atom WHERE current_refund_atom=prior_refund");});
 it("preserves entire original native and its180s acceptance budget",()=>{const original=read("tests/modules/controlled-atomic-refund-residual84.test.ts");expect(Buffer.byteLength(original)).toBe(19097);expect(hash(original)).toBe("c627b8fb89a1cefbab815727157a16a430472733474a1eb1ff7971c32a21332f");});
});
