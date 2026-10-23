// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Stored "video" bytes reach ffmpeg only as an allow-listed container, read
// with a named demuxer and the file protocol alone (C11.10).
//
// ffmpeg probes its input and follows what it finds. An HLS or concat
// playlist stored under a video label could otherwise make it open local
// files or fetch URLs. ffmpeg itself is replaced here, so each test records
// the exact argv and proves when it was never invoked.
import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotAllowedVideoError, sniffVideo } from "@/core/media/validation";
import { clipVideo, clipVideoArgs, videoDemuxerFor } from "@/modules/social/render";

const calls = vi.hoisted(() => [] as string[][]);

vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    calls.push([command, ...args]);
    // A clip run writes its output; `-version` only answers.
    if (args[0] !== "-version") writeFileSync(args[args.length - 1]!, "rendered");
    callback(null, "", "");
  },
}));

const mp4 = new Uint8Array(
  Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]),
);
const quicktime = new Uint8Array(
  Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0]),
);
const webm = new Uint8Array(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0, 0, 0]));

const playlists = {
  "HLS reading a local file": "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n",
  "HLS fetching a URL": "#EXTM3U\n#EXTINF:1,\nhttp://169.254.169.254/latest/meta-data/\n",
  "ffconcat list": "ffconcat version 1.0\nfile '/etc/passwd'\n",
  "SDP description": "v=0\nc=IN IP4 10.0.0.1\nm=video 5004 RTP/AVP 96\n",
};

beforeEach(() => {
  calls.length = 0;
});

describe("which stored bytes ffmpeg may read", () => {
  it("names one demuxer per allow-listed container", () => {
    expect(sniffVideo(mp4)).toBe("video/mp4");
    expect(videoDemuxerFor(mp4)).toBe("mov");
    expect(videoDemuxerFor(quicktime)).toBe("mov");
    expect(videoDemuxerFor(webm)).toBe("matroska");
  });

  for (const [name, body] of Object.entries(playlists)) {
    it(`refuses a ${name} stored as video/mp4 before ffmpeg runs`, async () => {
      const bytes = new Uint8Array(Buffer.from(body));
      expect(sniffVideo(bytes)).toBeUndefined();
      await expect(clipVideo(bytes, "9:16", 60, "clip.mp4")).rejects.toBeInstanceOf(
        NotAllowedVideoError,
      );
      // Not even `ffmpeg -version`: the refusal precedes any process.
      expect(calls).toHaveLength(0);
    });
  }

  it("refuses audio and images stored under a video label", async () => {
    const m4a = new Uint8Array(
      Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]),
    );
    const png = new Uint8Array(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    for (const bytes of [m4a, png]) {
      await expect(clipVideo(bytes, "1:1", 60, "clip.mp4")).rejects.toBeInstanceOf(
        NotAllowedVideoError,
      );
    }
    expect(calls).toHaveLength(0);
  });
});

describe("how ffmpeg is invoked", () => {
  it("puts the demuxer, protocol allow-list and drefs off before -i", () => {
    const args = clipVideoArgs({
      source: "/tmp/in.bin",
      output: "/tmp/out.mp4",
      demuxer: "mov",
      aspect: "9:16",
      maxDurationSeconds: 60,
    });
    const input = args.indexOf("-i");
    expect(args[input + 1]).toBe("/tmp/in.bin");
    expect(args.slice(args.indexOf("-f"), args.indexOf("-f") + 2)).toEqual(["-f", "mov"]);
    expect(args.indexOf("-f")).toBeLessThan(input);
    expect(
      args.slice(args.indexOf("-protocol_whitelist"), args.indexOf("-protocol_whitelist") + 2),
    ).toEqual(["-protocol_whitelist", "file"]);
    expect(args.indexOf("-protocol_whitelist")).toBeLessThan(input);
    expect(args.slice(args.indexOf("-enable_drefs"), args.indexOf("-enable_drefs") + 2)).toEqual(
      ["-enable_drefs", "0"],
    );
    expect(args.indexOf("-enable_drefs")).toBeLessThan(input);
    // Exactly one input.
    expect(args.filter((arg) => arg === "-i")).toHaveLength(1);
  });

  it("clips an MP4 with that argv", async () => {
    const clip = await clipVideo(mp4, "9:16", 60, "harbour.mp4");
    expect(clip).toMatchObject({ mime: "video/mp4", filename: "harbour-9x16.mp4" });
    const run = calls.find((call) => call[1] !== "-version")!;
    expect(run[0]).toBe("ffmpeg");
    const args = run.slice(1);
    expect(args).toEqual(
      clipVideoArgs({
        source: args[args.indexOf("-i") + 1]!,
        output: args[args.length - 1]!,
        demuxer: "mov",
        aspect: "9:16",
        maxDurationSeconds: 60,
      }),
    );
  });

  it("reads WebM with the matroska demuxer and no mov-only option", async () => {
    await clipVideo(webm, "1:1", 30, "loop.webm");
    const args = calls.find((call) => call[1] !== "-version")!.slice(1);
    expect(args.slice(args.indexOf("-f"), args.indexOf("-f") + 2)).toEqual(["-f", "matroska"]);
    expect(args).toContain("-protocol_whitelist");
    expect(args).not.toContain("-enable_drefs");
  });
});
