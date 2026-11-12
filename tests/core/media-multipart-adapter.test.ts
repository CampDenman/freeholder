// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.12: physical S3 outcomes must survive transport and protocol failures.
import {afterEach,describe,expect,it,vi} from "vitest";
import {createS3Storage} from "@/adapters/storage/s3";
const multipart=()=>createS3Storage({endpoint:"https://multipart.example.test",region:"test-1",bucket:"private",accessKeyId:"synthetic",secretAccessKey:"synthetic"}).directMultipart!;
afterEach(()=>vi.restoreAllMocks());
describe("original multipart provider facts",()=>{
 it("does not invisibly retry an ambiguous CREATE",async()=>{
  const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("<Error><Code>InternalError</Code></Error>",{status:500}));
  await expect(multipart().create("original/file.pdf","application/pdf")).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("rejects HTTP200 embedded completion errors without recording an ACK",async()=>{
  const accepted=vi.fn();vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("<Error><Code>InvalidPart</Code></Error>"));
  await expect(multipart().complete("original/file.pdf","original-id",[{partNumber:1,etag:'"part"'}],{onAccepted:accepted})).rejects.toThrow();expect(accepted).not.toHaveBeenCalled();
 });
 it("records completion ACK before a later object inspection fails",async()=>{
  const accepted=vi.fn();vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response("<CompleteMultipartUploadResult><ETag>result</ETag></CompleteMultipartUploadResult>")).mockResolvedValueOnce(new Response(null,{status:503}));
  await expect(multipart().complete("original/file.pdf","original-id",[{partNumber:1,etag:'"part"'}],{onAccepted:accepted})).rejects.toThrow();expect(accepted).toHaveBeenCalledTimes(1);
 });
 it("distinguishes an empty open multipart upload from authoritative absence",async()=>{
  vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response("<ListPartsResult><IsTruncated>false</IsTruncated></ListPartsResult>")).mockResolvedValueOnce(new Response("<Error><Code>NoSuchUpload</Code></Error>",{status:404}));
  const direct=multipart();expect(await direct.inspect!("original/file.pdf","original-id")).toEqual({state:"open",parts:[]});expect(await direct.inspect!("original/file.pdf","original-id")).toEqual({state:"absent"});
 });
 it("exhausts paginated exact-key CREATE inventory and excludes prefix neighbours",async()=>{
  const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(new Response("<ListMultipartUploadsResult><Upload><Key>original/file.pdf</Key><UploadId>first</UploadId></Upload><IsTruncated>true</IsTruncated><NextKeyMarker>original/file.pdf</NextKeyMarker><NextUploadIdMarker>first</NextUploadIdMarker></ListMultipartUploadsResult>")).mockResolvedValueOnce(new Response("<ListMultipartUploadsResult><Upload><Key>original/file.pdf.extra</Key><UploadId>neighbour</UploadId></Upload><Upload><Key>original/file.pdf</Key><UploadId>second</UploadId></Upload><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>"));
  expect(await multipart().listUploadsForKey!("original/file.pdf")).toEqual(["first","second"]);
  const request=fetch.mock.calls[1]![0];expect(request).toBeInstanceOf(Request);if(!(request instanceof Request))throw new Error("Expected a signed provider request");expect(new URL(request.url).searchParams.get("upload-id-marker")).toBe("first");
 });
 it("does not infer a lost CREATE's absence from a malformed inventory",async()=>{
  vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("<ListMultipartUploadsResult/>"));
  await expect(multipart().listUploadsForKey!("original/file.pdf")).rejects.toThrow();
 });
});
