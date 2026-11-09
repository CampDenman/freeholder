// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { verifyEmptyS3Inventory } from "@/adapters/storage/empty-inventory";
const config = {endpoint:"https://sfo3.digitaloceanspaces.com",region:"sfo3",bucket:"synthetic-only",accessKeyId:"synthetic-access",secretAccessKey:"synthetic-secret"};
const objects = '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>synthetic-only</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>';
const uploads = '<ListMultipartUploadsResult><Bucket>synthetic-only</Bucket><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>';
const versioning='<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>';
const replies = (...xml: string[]) => vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(xml.shift(),{status:200}));
describe("C10.32 complete empty provider inventory",()=>{
  it("signs both exact-bucket bounded reads, with no redirects or retries",async()=>{
    const request=replies(objects,uploads,versioning); await verifyEmptyS3Inventory(config,request);
    expect(request).toHaveBeenCalledTimes(3);
    const first=request.mock.calls[0]![0] as Request, second=request.mock.calls[1]![0] as Request;
    expect(first.url).toBe(config.endpoint+"/synthetic-only?list-type=2&max-keys=1&encoding-type=url");
    expect(second.url).toBe(config.endpoint+"/synthetic-only?uploads=&max-uploads=1");
    expect(first.redirect).toBe("manual");expect(first.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    expect((request.mock.calls[2]![0] as Request).url).toBe(config.endpoint+"/synthetic-only?versioning=");
  });
  for (const [name,xml] of [
    ["nonempty",objects.replace('<KeyCount>0','<KeyCount>1')],
    ["hidden object",objects.replace('</ListBucketResult>','<Contents></Contents></ListBucketResult>')],
    ["truncated",objects.replace('false','true')],
    ["foreign bucket",objects.replace('synthetic-only','another-business')],
    ["malformed XML",objects.replace('</Name>','</Wrong>')],
    ["duplicate state",objects.replace('</IsTruncated>','</IsTruncated><IsTruncated>true</IsTruncated>')],
    ["entity declaration",'<!DOCTYPE x [<!ENTITY a "b">]>'+objects],
    ["oversized",objects+' '.repeat(65536)],
  ] as const) it(`refuses ${name} without initializing`,async()=>{
    const request=replies(xml,uploads);await expect(verifyEmptyS3Inventory(config,request)).rejects.toThrow(/^storage_quota_inventory_/);
  });
  it("refuses an incomplete multipart upload even when ordinary object inventory is empty",async()=>{
    await expect(verifyEmptyS3Inventory(config,replies(objects,uploads.replace('</ListMultipartUploadsResult>','<Upload><Key>pending</Key></Upload></ListMultipartUploadsResult>')))).rejects.toMatchObject({code:"storage_quota_inventory_not_empty"});
  });
  it("refuses redirects/provider errors without retries or forwarding a signed request",async()=>{
    const request=vi.fn(async()=>new Response(null,{status:302,headers:{location:"https://foreign.test"}}));
    await expect(verifyEmptyS3Inventory(config,request)).rejects.toMatchObject({code:"storage_quota_inventory_unavailable"});expect(request).toHaveBeenCalledTimes(1);
  });
  for(const status of ["Enabled","Suspended"])it(`refuses retained versioning state ${status}`,async()=>{
    await expect(verifyEmptyS3Inventory(config,replies(objects,uploads,`<VersioningConfiguration><Status>${status}</Status></VersioningConfiguration>`))).rejects.toMatchObject({code:"storage_quota_versioning_not_disabled"});
  });
});
