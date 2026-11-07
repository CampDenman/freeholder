// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared PM duplex transport 0.1.10, bundled without product admission or billing.
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// client-library/duplex-versions/0.1.10/pm-ai-call-hooks.ts
function callHookEmitter(hooks, sessionId, now = Date.now) {
  const seen = /* @__PURE__ */ new Set();
  const safe = (run) => {
    try {
      run();
    } catch {
    }
  };
  return {
    state(state) {
      if (seen.has(state) || seen.has("ended")) return;
      seen.add(state);
      const at = now();
      safe(() => hooks?.onState?.(state, { ...sessionId === void 0 ? {} : { sessionId }, at }));
    },
    segment(speaker, text, startedAt, endedAt) {
      const trimmed = text.trim();
      if (hooks?.onTranscriptSegment === void 0 || trimmed.length === 0) return;
      const end = endedAt ?? now();
      safe(() => hooks.onTranscriptSegment?.({ speaker, text: trimmed, startedAt, endedAt: Math.max(startedAt, end), final: true }));
    },
    partial(speaker, text) {
      if (seen.has("ended")) return;
      safe(() => hooks?.onTranscriptPartial?.({ speaker, text }));
    },
    mute(muted) {
      if (hooks?.onMuteChange === void 0) return;
      safe(() => hooks.onMuteChange?.(muted));
    },
    replyUnavailable() {
      if (seen.has("ended")) return;
      safe(() => hooks?.onReplyUnavailable?.({ ...sessionId === void 0 ? {} : { sessionId }, at: now(), code: "no_usable_reply" }));
    }
  };
}

// client-library/duplex-versions/0.1.10/pm-ai-call-media.mts
var PM_AI_CALL_MEDIA_VERSION = "0.1.0";
var bounded = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
var FaceFrameMonitor = class {
  constructor(video, options) {
    this.video = video;
    this.options = options;
    __publicField(this, "phase", "starting");
    __publicField(this, "startedAt");
    __publicField(this, "lastFrameAt", null);
    __publicField(this, "firstFrameAfterMs", null);
    __publicField(this, "mediaTime", null);
    __publicField(this, "advancingFrames", 0);
    __publicField(this, "consecutiveFrames", 0);
    __publicField(this, "everLive", false);
    __publicField(this, "closed", false);
    __publicField(this, "frameHandle", null);
    __publicField(this, "decodedFrames", 0);
    __publicField(this, "interval");
    __publicField(this, "now");
    __publicField(this, "readyTimeoutMs");
    __publicField(this, "stallTimeoutMs");
    __publicField(this, "observation");
    this.now = options.now ?? (() => performance.now());
    this.startedAt = this.now();
    this.readyTimeoutMs = bounded(options.readyTimeoutMs, 1e4, 500, 3e4);
    this.stallTimeoutMs = bounded(options.stallTimeoutMs, 750, 200, 5e3);
    this.observation = typeof video.requestVideoFrameCallback === "function" ? "presented_frame_callback" : "decoded_frame_counter";
    this.decodedFrames = this.readDecodedFrames();
    this.interval = setInterval(() => this.tick(), 100);
    this.requestFrame();
  }
  snapshot() {
    return {
      version: PM_AI_CALL_MEDIA_VERSION,
      phase: this.phase,
      advancingFrames: this.advancingFrames,
      firstFrameAfterMs: this.firstFrameAfterMs,
      lastFrameAgeMs: this.lastFrameAt === null ? null : Math.max(0, this.now() - this.lastFrameAt),
      mediaTime: this.mediaTime,
      observation: this.observation
    };
  }
  /** Remote track ended, call closed, or the owning client disposed the element. */
  stop() {
    if (this.closed) return;
    this.close();
    this.change("ended");
  }
  requestFrame() {
    if (this.closed || this.observation !== "presented_frame_callback") return;
    this.frameHandle = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.frameHandle = null;
      if (this.closed) return;
      if (metadata.width > 0 && metadata.height > 0) this.recordFrame(metadata.mediaTime);
      this.requestFrame();
    });
  }
  readDecodedFrames() {
    const quality = this.video.getVideoPlaybackQuality?.();
    const total = quality?.totalVideoFrames;
    const dropped = quality?.droppedVideoFrames ?? 0;
    return typeof total === "number" && Number.isFinite(total) && Number.isFinite(dropped) ? Math.max(0, total - dropped) : 0;
  }
  recordFrame(mediaTime) {
    if (!Number.isFinite(mediaTime) || mediaTime < 0 || this.mediaTime !== null && mediaTime <= this.mediaTime) return;
    const now = this.now();
    if (!this.everLive && now - this.startedAt >= this.readyTimeoutMs) {
      this.close();
      this.change("timed_out");
      return;
    }
    if (this.lastFrameAt !== null && now - this.lastFrameAt > this.stallTimeoutMs) {
      this.consecutiveFrames = 0;
      if (this.phase === "live") this.change("stalled");
    }
    this.mediaTime = mediaTime;
    this.lastFrameAt = now;
    this.firstFrameAfterMs ?? (this.firstFrameAfterMs = Math.max(0, now - this.startedAt));
    this.advancingFrames++;
    this.consecutiveFrames++;
    if (this.consecutiveFrames >= 2) {
      this.everLive = true;
      this.change("live");
    }
  }
  tick() {
    if (this.closed) return;
    if (this.observation === "decoded_frame_counter") {
      const count = this.readDecodedFrames();
      if (count > this.decodedFrames && this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
        this.recordFrame(this.video.currentTime);
      }
      this.decodedFrames = count;
    }
    const now = this.now();
    if (!this.everLive && now - this.startedAt >= this.readyTimeoutMs) {
      this.close();
      this.change("timed_out");
    } else if (this.phase === "live" && this.lastFrameAt !== null && now - this.lastFrameAt > this.stallTimeoutMs) {
      this.consecutiveFrames = 0;
      this.change("stalled");
    }
  }
  change(phase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.options.onState(this.snapshot());
  }
  close() {
    this.closed = true;
    clearInterval(this.interval);
    if (this.frameHandle !== null) this.video.cancelVideoFrameCallback?.(this.frameHandle);
    this.frameHandle = null;
  }
};

// client-library/duplex-versions/0.1.10/pm-ai-duplex-client.ts
var PM_AI_DUPLEX_CLIENT_VERSION = "0.1.10";
var duplexCodecBase = "/api/hub/client-library/duplex-codec/";
var duplexFaceReadyMs = 1e4;
var duplexFaceRelayReadyMs = 4e3;
var duplexPreLiveMs = 8e3;
var duplexFirstAudioMs = 25e3;
var lipSyncMaxMs = 1e3;
var lipSyncDefaultMs = 120;
var lipSyncCrossfadeMs = 200;
var lipSyncFlushDrainMs = 150;
var lipSyncFlushRecoverMs = 250;
var faceAudioDefaultOffsetMs = 200;
var faceAudioMaxOffsetMs = 500;
var faceAudioDuckDownMs = 30;
var faceAudioDuckHoldMs = 200;
var faceAudioDuckUpMs = 100;
function parsePairedFaceTimeline(value) {
  const v = asRecord(value);
  if (v?.["version"] !== 1 || v["sample_rate"] !== 16e3 || v["video_fps"] !== 25 || v["paired_audio"] !== true || v["source_alignment"] !== "ordered_sdk_frames_unqualified") return void 0;
  return {
    version: 1,
    sample_rate: 16e3,
    video_fps: 25,
    paired_audio: true,
    source_alignment: "ordered_sdk_frames_unqualified"
  };
}
var duplexDecoderRestartLimit = 1;
function duplexWorkerErrorReason(worker, kind, afterFirstAudio, restarts) {
  return `${worker}_worker_${kind === "error" ? "error" : "messageerror"}; phase=${afterFirstAudio ? "after_first_audio" : "before_first_audio"}; restarts=${Math.max(0, Math.min(9, Math.trunc(restarts)))}`;
}
function duplexDegradeCopy(reason) {
  switch (reason) {
    case "face_unavailable":
      return "Video could not connect. Voice still works.";
    case "face_lost":
      return "Live video dropped. Continuing by voice.";
    case "codec_failed":
      return "This browser could not start live voice. Try another browser, or send a message.";
    case "pod_error":
      return "Trying another connection for this call.";
    default:
      return "The call could not connect. Try again or send a message.";
  }
}
function duplexSessionUpdate(grant) {
  return {
    type: "session.update",
    session: {
      instructions: { type: "constant", text: grant.instructions },
      voice: grant.voice,
      allow_recording: false,
      pm_grant: grant
    }
  };
}
function parseDuplexMessage(data) {
  if (typeof data !== "string") return void 0;
  try {
    const parsed = JSON.parse(data);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
var replyTimingStages = /* @__PURE__ */ new Set([
  "response_created",
  "eager_adopted",
  "confirmed_repeat_text",
  "eager_close_start",
  "eager_close_done",
  "tts_enroll_start",
  "tts_enroll_done",
  "tts_connect_start",
  "tts_ready",
  "generation_stream_entered",
  "llm_request_started",
  "llm_stream_opened",
  "llm_first_content",
  "first_guarded_text",
  "tts_get_start",
  "tts_get_ready",
  "first_text_sent",
  "first_pcm_received",
  "first_pcm_queued",
  "audio_done_queued"
]);
var replyTimingMetrics = [
  ["response_created", "response-created"],
  ["llm_first_content", "llm-first-token"],
  ["first_pcm_received", "pcm-first-received-by-worker"],
  ["first_pcm_queued", "pcm-first-queued-by-worker"]
];
var replyEventId = /^event_[A-Za-z0-9]{21}$/u;
function createDuplexReplyTimingMetrics(emit) {
  let closed = false;
  let nextTurn = 0;
  const seen = /* @__PURE__ */ new Set();
  let current;
  const invalidate = () => {
    current = void 0;
  };
  return {
    invalidate,
    close() {
      closed = true;
      invalidate();
      seen.clear();
    },
    handle(message) {
      try {
        if (closed) return;
        const type = message["type"];
        if (type === "session.updated" || type === "input_audio_buffer.speech_started" || type === "response.cancelled" || type === "unmute.interrupted_by_vad" || type === "response.done" || type === "response.audio.done") {
          invalidate();
          return;
        }
        if (type === "response.created") {
          const id = message["event_id"];
          if (typeof id !== "string" || id.length !== 27 || !replyEventId.test(id)) {
            invalidate();
            return;
          }
          if (current?.eventId === id) return;
          if (seen.has(id) || nextTurn >= 1e4) {
            invalidate();
            return;
          }
          seen.add(id);
          current = { eventId: id, turn: ++nextTurn, observed: {} };
          return;
        }
        if (type !== "unmute.additional_outputs" || current === void 0) return;
        const probe = asRecord(asRecord(asRecord(message["args"])?.["debug_dict"])?.["reply_timing_v1"]);
        if (probe === void 0 || Object.keys(probe).length !== 3 || Object.keys(probe).some((key) => !["version", "responseEventId", "elapsedMs"].includes(key)) || probe["version"] !== 1 || probe["responseEventId"] !== current.eventId) return;
        const points = asRecord(probe["elapsedMs"]);
        if (points === void 0 || points["response_created"] !== 0 || Object.keys(points).length > replyTimingStages.size || Object.entries(points).some(([stage, value]) => !replyTimingStages.has(stage) || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 36e5)) return;
        if (points["first_pcm_queued"] !== void 0 && (typeof points["first_pcm_received"] !== "number" || points["first_pcm_queued"] < points["first_pcm_received"])) return;
        if (Object.entries(current.observed).some(([stage, value]) => points[stage] !== value)) return;
        const owner = current;
        const additions = replyTimingMetrics.filter(([stage]) => points[stage] !== void 0 && owner.observed[stage] === void 0);
        owner.observed = { ...points };
        for (const [stage, metricStage] of additions) {
          if (closed || current !== owner) return;
          try {
            const result = emit({ turn: owner.turn, stage: metricStage, clock: "server", elapsedMs: owner.observed[stage] });
            void Promise.resolve(result).catch(() => void 0);
          } catch {
          }
        }
      } catch {
      }
    }
  };
}
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function extractAiCallTranscript(envelope) {
  const outerType = typeof envelope["type"] === "string" ? envelope["type"] : "";
  const frame = asRecord(envelope["data"]) ?? envelope;
  const type = typeof frame["type"] === "string" ? frame["type"] : outerType;
  const message = asRecord(frame["message"]) ?? frame;
  if (frame["interim"] === true || message["interim"] === true) return null;
  const content = message["content"] ?? message["text"] ?? frame["transcript"] ?? frame["text"] ?? envelope["transcript"] ?? envelope["text"];
  const text = typeof content === "string" ? content.trim() : "";
  if (text.length === 0) return null;
  const roleValue = message["role"] ?? frame["role"] ?? envelope["role"];
  const role = typeof roleValue === "string" ? roleValue : "";
  if (type === "user_message" || role === "user") return { role: "you", text };
  if (type === "assistant_message" || role === "assistant") return { role: "them", text };
  if (/transcript|message/iu.test(type)) return { role: role === "user" ? "you" : "them", text };
  return null;
}
function joinCaptionDelta(line, delta) {
  return line.length === 0 || /^[\s.,!?;:)\]}'’–-]/u.test(delta) ? line + delta : `${line} ${delta}`;
}
function createDuplexCaptions(emit, now = Date.now, partial) {
  let you = "";
  let them = "";
  let youAt = 0;
  let themAt = 0;
  const finishYou = () => {
    if (you.trim().length > 0) emit({ role: "you", text: you.trim() }, youAt, now());
    if (you.length > 0) partial?.({ role: "you", text: "" });
    you = "";
  };
  const finishThem = () => {
    if (them.trim().length > 0) emit({ role: "them", text: them.trim() }, themAt, now());
    if (them.length > 0) partial?.({ role: "them", text: "" });
    them = "";
  };
  return {
    handle(message) {
      const type = message["type"];
      const delta = message["delta"];
      if (type === "conversation.item.input_audio_transcription.delta" && typeof delta === "string") {
        finishThem();
        if (you.length === 0) youAt = now();
        you = joinCaptionDelta(you, delta);
        partial?.({ role: "you", text: you });
      } else if (type === "response.text.delta" && typeof delta === "string") {
        finishYou();
        if (them.length === 0) themAt = now();
        them = joinCaptionDelta(them, delta);
        partial?.({ role: "them", text: them });
      } else if (type === "response.text.done" || type === "response.done") {
        finishYou();
        finishThem();
      } else if (type === "user_message" || type === "assistant_message" || asRecord(message["data"]) !== void 0) {
        const turn = extractAiCallTranscript(message);
        if (turn !== null) {
          const at = now();
          emit(turn, at, at);
        }
      }
    },
    flush() {
      finishYou();
      finishThem();
    }
  };
}
function isOggBeginningOfStream(page) {
  return page.length > 5 && page[0] === 79 && page[1] === 103 && page[2] === 103 && page[3] === 83 && (page[5] & 2) !== 0;
}
function clampLipSyncMs(lipSyncMs) {
  if (typeof lipSyncMs !== "number" || !Number.isFinite(lipSyncMs)) return lipSyncDefaultMs;
  return Math.min(lipSyncMaxMs, Math.max(0, lipSyncMs));
}
function clampFaceAudioOffsetMs(offsetMs) {
  if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs)) return faceAudioDefaultOffsetMs;
  return Math.min(faceAudioMaxOffsetMs, Math.max(0, offsetMs));
}
function isDuplexInterruptMessage(type) {
  return type === "input_audio_buffer.speech_started" || type === "response.cancelled";
}
function oggStreamHeader(page) {
  if (!isOggBeginningOfStream(page) || page.length < 27) return void 0;
  const segments = page[26];
  if (page.length < 27 + segments) return void 0;
  let length = 27 + segments;
  for (let index = 0; index < segments; index += 1) length += page[27 + index];
  return page.length >= length ? page.slice(0, length) : void 0;
}
function createPagePump(send, maxQueued = 3e3) {
  const queue = [];
  let ready = false;
  let muted = false;
  const frame = (audio) => JSON.stringify({ type: "input_audio_buffer.append", audio });
  return {
    page(base64, header) {
      if (muted && !header) return;
      if (!ready) {
        if (queue.length < maxQueued) queue.push(base64);
        return;
      }
      send(frame(base64));
    },
    open() {
      ready = true;
      while (queue.length > 0) send(frame(queue.shift()));
    },
    setMuted(next) {
      muted = next;
    },
    queued: () => queue.length
  };
}
function createLipSyncVoiceDelay(ctx, output, sink, lipSyncMs) {
  const targetSec = clampLipSyncMs(lipSyncMs) / 1e3;
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const bus = ctx.createGain();
  let delay = ctx.createDelay(1.5);
  dry.gain.value = 1;
  wet.gain.value = 0;
  bus.gain.value = 1;
  delay.delayTime.value = targetSec;
  output.connect(dry);
  dry.connect(bus);
  output.connect(delay);
  delay.connect(wet);
  wet.connect(bus);
  bus.connect(sink);
  let connected = true;
  let disposed = false;
  const connectSource = () => {
    if (connected || disposed) return;
    output.connect(dry);
    output.connect(delay);
    connected = true;
  };
  let faceLive = false;
  let wsAudible = true;
  const rampGain = (param, value, now) => {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + lipSyncCrossfadeMs / 1e3);
  };
  return {
    isFaceLive: () => faceLive,
    isWsAudible: () => wsAudible,
    setFaceLive(live) {
      if (live === faceLive) return;
      faceLive = live;
      const now = ctx.currentTime;
      rampGain(dry.gain, live ? 0 : 1, now);
      rampGain(wet.gain, live ? 1 : 0, now);
    },
    setWsAudible(audible) {
      if (audible === wsAudible) return;
      wsAudible = audible;
      const now = ctx.currentTime;
      rampGain(bus.gain, audible ? 1 : 0, now);
    },
    flush(waitForSourceReset = false) {
      if (disposed) return;
      if (connected) {
        output.disconnect(dry);
        output.disconnect(delay);
        connected = false;
      }
      delay.disconnect();
      delay = ctx.createDelay(1.5);
      delay.delayTime.value = targetSec;
      delay.connect(wet);
      if (!waitForSourceReset) connectSource();
    },
    resumeAfterReset: connectSource,
    disconnect() {
      disposed = true;
      if (connected) {
        try {
          output.disconnect(dry);
        } catch {
        }
        try {
          output.disconnect(delay);
        } catch {
        }
        connected = false;
      }
      try {
        dry.disconnect();
      } catch {
      }
      try {
        wet.disconnect();
      } catch {
      }
      try {
        bus.disconnect();
      } catch {
      }
      try {
        delay.disconnect();
      } catch {
      }
    }
  };
}
function createFaceAudioVoice(ctx, audioTrack, sink, offsetMs) {
  const delay = ctx.createDelay(1);
  delay.delayTime.value = clampFaceAudioOffsetMs(offsetMs) / 1e3;
  const duck = ctx.createGain();
  duck.gain.value = 0;
  const stream = new MediaStream([audioTrack]);
  const source = ctx.createMediaStreamSource(stream);
  source.connect(delay);
  delay.connect(duck);
  duck.connect(sink);
  let active = false;
  let closed = false;
  const player = document.createElement("audio");
  player.hidden = true;
  player.muted = true;
  player.srcObject = stream;
  document.body?.append(player);
  let ready;
  try {
    ready = player.play().then(() => !closed, () => false);
  } catch {
    ready = Promise.resolve(false);
  }
  return {
    ready,
    isActive: () => active,
    setActive(next) {
      if (closed) return;
      if (next === active) return;
      active = next;
      const now = ctx.currentTime;
      duck.gain.cancelScheduledValues(now);
      duck.gain.setValueAtTime(duck.gain.value, now);
      duck.gain.linearRampToValueAtTime(next ? 1 : 0, now + lipSyncCrossfadeMs / 1e3);
    },
    duckVoice() {
      if (!active) return;
      const now = ctx.currentTime;
      const holdUntil = now + faceAudioDuckHoldMs / 1e3;
      duck.gain.cancelScheduledValues(now);
      duck.gain.setValueAtTime(duck.gain.value, now);
      duck.gain.linearRampToValueAtTime(0, now + faceAudioDuckDownMs / 1e3);
      duck.gain.setValueAtTime(0, holdUntil);
      duck.gain.linearRampToValueAtTime(1, holdUntil + faceAudioDuckUpMs / 1e3);
    },
    disconnect() {
      if (closed) return;
      closed = true;
      active = false;
      try {
        player.pause();
      } catch {
      }
      player.srcObject = null;
      player.remove();
      try {
        source.disconnect();
      } catch {
      }
      try {
        delay.disconnect();
      } catch {
      }
      try {
        duck.disconnect();
      } catch {
      }
    }
  };
}
function syncVoicePaths(input) {
  const pending = input.enabled && input.faceLive && input.awaitingRelay === true;
  const useFaceAudio = !pending && input.enabled && input.faceLive && input.hasFaceAudio;
  input.lipSync?.setFaceLive(input.faceLive);
  input.lipSync?.setWsAudible(!useFaceAudio && !pending);
  input.faceAudio?.setActive(useFaceAudio);
}
function observeSelectedAudioOutput(ctx, output, sink, eligible, onAudible) {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const samples = new Float32Array(analyser.fftSize);
  output.connect(analyser);
  analyser.connect(sink);
  let closed = false;
  let observed = false;
  let eligibleSince;
  let notBefore = 0;
  let timer;
  const poll = () => {
    if (closed || observed) return;
    if (ctx.state !== "running" || !eligible()) eligibleSince = void 0;
    else {
      const now = ctx.currentTime;
      eligibleSince ?? (eligibleSince = Math.max(now, notBefore));
      if (now - eligibleSince >= samples.length / ctx.sampleRate) {
        analyser.getFloatTimeDomainData(samples);
        let power = 0;
        for (const value of samples) power += value * value;
        const rms = Math.sqrt(power / samples.length);
        if (Number.isFinite(rms) && rms > 1e-4) {
          observed = true;
          onAudible();
          return;
        }
      }
    }
    timer = globalThis.setTimeout(poll, 20);
  };
  timer = globalThis.setTimeout(poll, 20);
  return {
    reset: (settleMs = 0) => {
      eligibleSince = void 0;
      notBefore = ctx.currentTime + settleMs / 1e3;
    },
    disconnect() {
      if (closed) return;
      closed = true;
      if (timer !== void 0) globalThis.clearTimeout(timer);
      try {
        output.disconnect(analyser);
      } catch {
      }
      try {
        analyser.disconnect();
      } catch {
      }
    }
  };
}
function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return globalThis.btoa(binary);
}
function base64ToBytes(value) {
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return void 0;
  }
}
function waitForIce(pc, capMs = 4e3) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState !== "complete") return;
      pc.removeEventListener("icegatheringstatechange", done);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", done);
    globalThis.setTimeout(resolve, capMs);
  });
}
async function startDuplexCall(started, onTranscript, deps, hooks) {
  const grant = started.duplex;
  const sessionId = started.sessionId;
  if (grant === void 0 || sessionId === void 0) return void 0;
  const emit = callHookEmitter(hooks, sessionId);
  const callerStream = hooks?.localStream;
  const ditto = started.callKind === "video" ? grant.ditto : void 0;
  const codecBase = deps.codecBase ?? duplexCodecBase;
  const faceAudioVoiceEnabled = ditto !== void 0 && deps.faceAudioVoiceEnabled === true;
  const report = (stage, detail, level = "info") => {
    try {
      const result = deps.report(sessionId, stage, detail, level);
      void Promise.resolve(result).catch(() => void 0);
    } catch {
    }
  };
  const replyMetrics = createDuplexReplyTimingMetrics((metric) => report("call-metrics-v1", JSON.stringify(metric)));
  const faceState = (state) => {
    try {
      deps.onFaceState?.(state);
    } catch {
    }
  };
  const ENDED = Symbol("call-ended");
  let releaseEnded = () => void 0;
  const ended = new Promise((resolve) => {
    releaseEnded = () => resolve(ENDED);
  });
  const untilEnded = (pending) => Promise.race([pending, ended]);
  let running = true;
  let hardFailure = false;
  let podLive = false;
  let firstAudioOutput = false;
  let faceAudioPlayoutReady = false;
  let faceRelayReady = false;
  let faceRelayTimer;
  let faceFramesLive = false;
  let detachFaceAudioTrack;
  let pairedFaceTimeline;
  let microphoneReady = false;
  let faceSettled = ditto === void 0;
  let faceLive = false;
  let faceEvicted = false;
  let faceAbandoned = false;
  let faceMonitor;
  const faceOfferAbort = new AbortController();
  let muted = false;
  let paused = false;
  let replyOpen = false;
  let replyHasOutput = false;
  let emptyTextDone = false;
  let dropReply = false;
  let dropHeldAudio = () => void 0;
  let turnPhase = "listening";
  let ws;
  let pc;
  let decoder;
  let decoderGeneration = 0;
  let decoderHeader;
  let encoder;
  let micSource;
  let micProcessor;
  let micSink;
  let output;
  let lipSync;
  let faceAudio;
  let gain;
  let audibleOutput;
  let stream;
  const timers = [];
  const captions = createDuplexCaptions((turn, startedAt, endedAt) => {
    onTranscript?.(turn.role === "you" ? `You: ${turn.text}` : turn.text);
    emit.segment(turn.role === "you" ? "member" : "muse", turn.text, startedAt, endedAt);
  }, Date.now, (turn) => emit.partial(turn.role === "you" ? "member" : "muse", turn.text));
  const relayPending = () => faceAudioVoiceEnabled && pairedFaceTimeline !== void 0 && !faceAbandoned && !faceRelayReady;
  const checkLive = () => {
    if (running && podLive && microphoneReady && firstAudioOutput && faceSettled && !relayPending()) emit.state("live");
  };
  const pump = createPagePump((message) => {
    if (ws?.readyState === 1) ws.send(message);
  });
  const stop = () => {
    if (!running) return;
    running = false;
    replyMetrics.close();
    releaseEnded();
    captions.flush();
    emit.state("ended");
    for (const timer of timers) globalThis.clearTimeout(timer);
    audibleOutput?.disconnect();
    detachFaceAudioTrack?.();
    detachFaceAudioTrack = void 0;
    faceMonitor?.stop();
    faceOfferAbort.abort();
    try {
      ws?.close();
    } catch {
    }
    try {
      pc?.close();
    } catch {
    }
    try {
      micProcessor?.disconnect();
      micSource?.disconnect();
      micSink?.disconnect();
    } catch {
    }
    try {
      encoder?.terminate();
      decoder?.terminate();
    } catch {
    }
    try {
      output?.disconnect();
      lipSync?.disconnect();
      faceAudio?.disconnect();
      gain?.disconnect();
    } catch {
    }
    if (callerStream === void 0) stream?.getTracks().forEach((track) => track.stop());
    deps.signal?.removeEventListener("abort", stop);
    try {
      void Promise.resolve(deps.endSession(sessionId)).catch(() => void 0);
    } catch {
    }
  };
  const fail = (reason, detail) => {
    if (!running) return;
    report(reason, detail, "error");
    onTranscript?.(duplexDegradeCopy(reason));
    hardFailure = true;
    emit.state("failed");
    stop();
  };
  deps.signal?.addEventListener("abort", stop, { once: true });
  if (deps.signal?.aborted) {
    stop();
    return void 0;
  }
  try {
    const ctx = deps.audioContext();
    if (ctx === void 0 || typeof globalThis.AudioWorkletNode !== "function" || typeof globalThis.Worker !== "function" || typeof globalThis.WebSocket !== "function") {
      fail("codec_failed", "audio worklet, worker, websocket, or unlocked audio context unavailable");
      return void 0;
    }
    if (ctx.state === "suspended" && await untilEnded(ctx.resume().catch(() => void 0)) === ENDED) return void 0;
    if (!running) return void 0;
    emit.state("connecting");
    const microphone = callerStream ? Promise.resolve(callerStream) : deps.microphone();
    void microphone.then((late) => {
      if (!running && callerStream === void 0) late?.getTracks().forEach((track) => track.stop());
    }, () => void 0);
    const acquired = await untilEnded(microphone);
    if (acquired === ENDED || !running) return void 0;
    stream = acquired;
    if (stream === void 0) {
      onTranscript?.("Microphone is unavailable. Allow microphone access and try the call again, or type a message.");
      stop();
      return void 0;
    }
    try {
      output = new AudioWorkletNode(ctx, "audio-output-processor-reset-v1");
    } catch {
      if (await untilEnded(ctx.audioWorklet.addModule(`${codecBase}audio-output-processor.js?v=20261021-reset-barrier`)) === ENDED) return void 0;
      if (!running) return void 0;
      output = new AudioWorkletNode(ctx, "audio-output-processor-reset-v1");
    }
    gain = ctx.createGain();
    if (faceAudioVoiceEnabled) {
      audibleOutput = observeSelectedAudioOutput(
        ctx,
        gain,
        ctx.destination,
        () => running && !paused && faceSettled && !relayPending(),
        () => {
          if (!running || paused) return;
          firstAudioOutput = true;
          report("first-audio-output", "selected browser output produced non-silent audio after path selection and pause gain");
          checkLive();
        }
      );
    } else gain.connect(ctx.destination);
    if (ditto !== void 0) {
      lipSync = createLipSyncVoiceDelay(ctx, output, gain, ditto.lip_sync_ms);
    } else {
      output.connect(gain);
    }
    const attachFaceAudio = (track) => {
      if (faceAudio !== void 0 || lipSync === void 0 || pairedFaceTimeline === void 0) return;
      faceAudio = createFaceAudioVoice(ctx, track, gain, 0);
      const attached = faceAudio;
      let playerStarted = false;
      let wasPlayable = false;
      const current = () => running && !faceAbandoned && faceAudio === attached;
      const activate = () => {
        if (!current() || track.readyState === "ended") return;
        if (!track.muted) {
          wasPlayable = true;
          if (playerStarted && initialAudioTimer !== void 0) globalThis.clearTimeout(initialAudioTimer);
        }
        faceAudioPlayoutReady = true;
        if (faceFramesLive) applyFaceState(true);
      };
      const retire = () => {
        if (!current()) return;
        report("face-audio-unavailable", "paired audio ended or lost connectivity; face retired and streamed voice restored", "warn");
        abandonFace();
      };
      const onMute = () => {
        if (wasPlayable) retire();
      };
      track.addEventListener("ended", retire);
      track.addEventListener("mute", onMute);
      track.addEventListener("unmute", activate);
      detachFaceAudioTrack = () => {
        if (initialAudioTimer !== void 0) globalThis.clearTimeout(initialAudioTimer);
        track.removeEventListener("ended", retire);
        track.removeEventListener("mute", onMute);
        track.removeEventListener("unmute", activate);
      };
      const initialAudioTimer = globalThis.setTimeout(() => {
        if (!wasPlayable || !playerStarted) retire();
      }, duplexFaceReadyMs);
      if (track.readyState === "ended") retire();
      else activate();
      void attached.ready.then((ready) => {
        if (!current()) return;
        if (!ready || track.readyState === "ended") {
          retire();
          return;
        }
        playerStarted = true;
        activate();
        report("face-audio-playout", "remote audio player started; shared output graph owns sound");
      });
    };
    const worklet = output;
    let resetGeneration = 0;
    worklet.port.onmessage = (event) => {
      if (event.data?.type === "audio-output-reset") {
        if (!running || event.data.generation !== resetGeneration) return;
        lipSync?.resumeAfterReset();
        worklet.port.postMessage({ type: "resume", generation: resetGeneration });
        return;
      }
      if (faceAudioVoiceEnabled || !running || paused || event.data?.type !== "audio-output-started" || firstAudioOutput) return;
      firstAudioOutput = true;
      report("first-audio-output", "browser worklet produced non-silent output");
      checkLive();
    };
    let decoderRestarts = 0;
    const onDecoderError = (generation, kind, event) => {
      if (!running || generation !== decoderGeneration) return;
      event.preventDefault();
      const reason = duplexWorkerErrorReason("decoder", kind, firstAudioOutput, decoderRestarts);
      report("decoder-error", reason, decoderRestarts < duplexDecoderRestartLimit ? "warn" : "error");
      if (decoderRestarts >= duplexDecoderRestartLimit) {
        fail("codec_failed", `decoder_worker_failed_after_restart; ${reason}`);
        return;
      }
      decoderRestarts += 1;
      try {
        decoder?.terminate();
      } catch {
      }
      startDecoder();
      report("decoder-restart", `decoder worker restarted (${decoderRestarts}/${duplexDecoderRestartLimit}); output graph retained`, "warn");
    };
    const startDecoder = () => {
      decoderGeneration += 1;
      const generation = decoderGeneration;
      const worker = new Worker(`${codecBase}decoderWorker.min.js`);
      decoder = worker;
      worker.onmessage = (event) => {
        if (!running || generation !== decoderGeneration || event.data === null || event.data[0] === void 0) return;
        worklet.port.postMessage({ frame: event.data[0], type: "audio", micDuration: 0 });
      };
      worker.onerror = (event) => onDecoderError(generation, "error", event);
      worker.onmessageerror = (event) => onDecoderError(generation, "messageerror", event);
      worker.postMessage({
        command: "init",
        bufferLength: 960 * ctx.sampleRate / 24e3,
        decoderSampleRate: 24e3,
        outputBufferSampleRate: ctx.sampleRate,
        resampleQuality: 0
      });
      if (decoderHeader !== void 0) worker.postMessage({ command: "decode", pages: decoderHeader.slice() });
    };
    startDecoder();
    const clearInterruptedAudio = () => {
      audibleOutput?.reset(faceAudioDuckHoldMs + faceAudioDuckUpMs);
      decoder?.terminate();
      resetGeneration += 1;
      lipSync?.flush(true);
      worklet.port.postMessage({ type: "reset", generation: resetGeneration });
      faceAudio?.duckVoice();
      startDecoder();
    };
    dropHeldAudio = clearInterruptedAudio;
    let settleFace = () => void 0;
    let faceReadyResolve = () => void 0;
    let faceStartupTimer;
    const applyFaceState = (ok) => {
      if (!running || ok && faceAbandoned) return;
      faceFramesLive = ok;
      if (ok && faceAudioVoiceEnabled && pairedFaceTimeline !== void 0 && !faceAudioPlayoutReady) return;
      const wasLive = faceLive;
      const wasSettled = faceSettled;
      faceSettled = true;
      faceLive = ok;
      faceEvicted = !ok;
      if (faceStartupTimer !== void 0) globalThis.clearTimeout(faceStartupTimer);
      audibleOutput?.reset(lipSyncCrossfadeMs);
      syncVoicePaths({ enabled: faceAudioVoiceEnabled, faceLive: ok, hasFaceAudio: faceAudio !== void 0 && faceAudioPlayoutReady && faceRelayReady, awaitingRelay: relayPending(), lipSync, faceAudio });
      faceState(ok ? relayPending() ? "connecting" : "playing" : "failed");
      if (!ok && (!wasSettled || wasLive)) {
        const reason = wasSettled ? "face_lost" : "face_unavailable";
        report(reason, wasSettled ? "face frames stopped advancing" : "face startup failed", "warn");
        onTranscript?.(duplexDegradeCopy(reason));
      }
      checkLive();
      faceReadyResolve();
    };
    const abandonFace = () => {
      if (!running || faceAbandoned) return;
      faceAbandoned = true;
      faceRelayReady = false;
      if (faceRelayTimer !== void 0) globalThis.clearTimeout(faceRelayTimer);
      faceMonitor?.stop();
      faceOfferAbort.abort();
      detachFaceAudioTrack?.();
      detachFaceAudioTrack = void 0;
      faceAudio?.disconnect();
      faceAudio = void 0;
      faceAudioPlayoutReady = false;
      try {
        pc?.close();
      } catch {
      }
      applyFaceState(false);
    };
    const faceReady = new Promise((resolve) => {
      faceReadyResolve = resolve;
      if (ditto === void 0) {
        resolve();
        return;
      }
      settleFace = (ok) => {
        if (ok) applyFaceState(true);
        else abandonFace();
      };
      faceStartupTimer = globalThis.setTimeout(() => abandonFace(), duplexFaceReadyMs);
      timers.push(faceStartupTimer);
    });
    if (ditto !== void 0) {
      void (async () => {
        const video = deps.videoElement;
        if (!video) throw new Error("no video surface");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        faceState("connecting");
        const peer = new RTCPeerConnection({ iceServers: started.iceServers ?? [] });
        pc = peer;
        const update = () => {
          if (peer.connectionState === "failed" || peer.iceConnectionState === "failed" || peer.connectionState === "closed" || peer.iceConnectionState === "closed") abandonFace();
        };
        peer.addEventListener("connectionstatechange", update);
        peer.addEventListener("iceconnectionstatechange", update);
        const remote = new MediaStream();
        peer.addEventListener("track", (event) => {
          if (!running || faceAbandoned) return;
          if (event.track.kind === "audio" && faceAudioVoiceEnabled) attachFaceAudio(event.track);
          if (event.track.kind !== "video") return;
          remote.addTrack(event.track);
          video.srcObject = remote;
          video.muted = true;
          void video.play()?.catch(() => void 0);
          event.track.addEventListener("ended", () => abandonFace());
          faceMonitor?.stop();
          faceMonitor = new FaceFrameMonitor(video, {
            readyTimeoutMs: duplexFaceReadyMs,
            onState: (observation) => {
              if (!running || faceAbandoned || observation.phase === "ended") return;
              report("face-frames", JSON.stringify(observation));
              if (observation.phase === "live") applyFaceState(true);
              else if (observation.phase === "stalled") {
                if (faceAudioVoiceEnabled && pairedFaceTimeline !== void 0) abandonFace();
                else applyFaceState(false);
              } else if (observation.phase === "timed_out") abandonFace();
            }
          });
        });
        peer.addTransceiver("video", { direction: "recvonly" });
        peer.addTransceiver("audio", { direction: "recvonly" });
        const offer = await peer.createOffer();
        if (!running || faceAbandoned) return;
        await peer.setLocalDescription(offer);
        await waitForIce(peer);
        if (!running || faceAbandoned) return;
        const offered = Date.now();
        const answer = await fetch(ditto.offer_url, {
          signal: faceOfferAbort.signal,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sdp: peer.localDescription?.sdp,
            type: peer.localDescription?.type,
            session_id: ditto.session_id,
            ...ditto.source_url === void 0 ? {} : { source: ditto.source_url },
            ...ditto.sig === void 0 ? {} : { sig: ditto.sig, exp: ditto.exp }
          })
        });
        report("face-offer", `HTTP ${answer.status} in ${Date.now() - offered}ms`, answer.ok ? "info" : "error");
        if (!answer.ok) throw new Error(`face offer HTTP ${answer.status}`);
        const body = await answer.json();
        pairedFaceTimeline = parsePairedFaceTimeline(body.media_timeline);
        if (faceAudioVoiceEnabled) report("face-media-timeline", pairedFaceTimeline ? "paired timeline v1; zero additional audio hold; device alignment unqualified" : "worker has no supported paired timeline; streamed voice retained", pairedFaceTimeline ? "info" : "warn");
        if (faceAudioVoiceEnabled && pairedFaceTimeline === void 0) throw new Error("paired worker timeline unavailable");
        if (body.sdp === void 0) throw new Error("face answer had no SDP");
        if (!running || faceAbandoned) return;
        await peer.setRemoteDescription({ type: body.type ?? "answer", sdp: body.sdp });
      })().catch((error) => {
        if (!running || faceAbandoned) return;
        report("face-failed", error instanceof Error ? error.message : String(error), "warn");
        settleFace(false);
      });
    }
    let attempts = 0;
    let sessionSent = false;
    const openSocket = () => {
      attempts += 1;
      replyMetrics.invalidate();
      const socket = new WebSocket(grant.ws_url, ["realtime"]);
      ws = socket;
      socket.onopen = () => {
        void faceReady.then(() => {
          if (!running || ws !== socket || socket.readyState !== 1) return;
          socket.send(JSON.stringify(duplexSessionUpdate(grant)));
          sessionSent = true;
          if (relayPending()) {
            faceRelayTimer = globalThis.setTimeout(() => {
              if (!running || ws !== socket || !relayPending()) return;
              report("face-relay-timeout", "voice-to-face relay did not confirm readiness; voice retained", "warn");
              abandonFace();
            }, duplexFaceRelayReadyMs);
            timers.push(faceRelayTimer);
          }
          pump.open();
        });
      };
      socket.onmessage = (event) => {
        if (!running || ws !== socket) return;
        const message = parseDuplexMessage(event.data);
        if (message === void 0) return;
        if (podLive && !paused && (!dropReply || message["type"] === "response.created")) replyMetrics.handle(message);
        else replyMetrics.invalidate();
        const type = message["type"];
        if (type === "unmute.face_relay") {
          if (ditto === void 0 || faceAbandoned || message["version"] !== 1 || message["session_id"] !== ditto.session_id) return;
          if (message["state"] === "failed") {
            report("face-relay-failed", "voice-to-face relay stopped; face retired and voice restored", "warn");
            abandonFace();
          } else if (message["state"] === "ready" && faceAudioVoiceEnabled && pairedFaceTimeline !== void 0) {
            faceRelayReady = true;
            if (faceRelayTimer !== void 0) globalThis.clearTimeout(faceRelayTimer);
            if (faceFramesLive) applyFaceState(true);
          }
          return;
        }
        if (type === "response.created" || type === "input_audio_buffer.speech_started" || type === "response.cancelled") {
          replyHasOutput = false;
          emptyTextDone = false;
        }
        if (type === "response.audio.delta" || type === "response.text.delta" && typeof message["delta"] === "string" && message["delta"].length > 0) {
          replyHasOutput = true;
          emptyTextDone = false;
        }
        if (type === "response.text.done") {
          emptyTextDone = replyOpen && !replyHasOutput && message["text"] === "";
        }
        if (type === "response.audio.done" && emptyTextDone && !replyHasOutput) {
          if (!paused && !dropReply) emit.replyUnavailable();
          turnPhase = "listening";
          replyOpen = false;
          dropReply = false;
          emptyTextDone = false;
        }
        if (type === "response.audio.delta" && relayPending()) abandonFace();
        if (type === "input_audio_buffer.speech_stopped" || type === "response.created" || type === "response.text.delta") {
          turnPhase = "thinking";
        } else if (type === "input_audio_buffer.speech_started" || type === "response.cancelled" || type === "unmute.interrupted_by_vad" || type === "response.done") {
          turnPhase = "listening";
        }
        if (type === "response.created" || type === "response.audio.delta" || type === "response.text.delta") {
          if (type === "response.created" && !paused) dropReply = false;
          replyOpen = true;
        } else if (type === "response.done" || type === "response.cancelled" || type === "input_audio_buffer.speech_started") {
          const dropped = paused || dropReply;
          replyOpen = false;
          dropReply = false;
          if (dropped && type !== "input_audio_buffer.speech_started") return;
        }
        if ((paused || dropReply) && (type === "response.audio.delta" || type === "response.text.delta" || type === "response.text.done" || extractAiCallTranscript(message)?.role === "them")) {
          return;
        }
        if (type === "session.updated") {
          if (!podLive) {
            report("session-updated", `live after ${attempts} attempt(s)`);
            timers.push(globalThis.setTimeout(() => {
              if (running && !firstAudioOutput) fail("pre_live_timeout", `no reply audio within ${duplexFirstAudioMs}ms`);
            }, duplexFirstAudioMs));
          }
          podLive = true;
          checkLive();
        } else if (type === "response.audio.delta" && typeof message["delta"] === "string") {
          const bytes = base64ToBytes(message["delta"]);
          if (bytes === void 0 || decoder === void 0) return;
          turnPhase = "speaking";
          decoderHeader ?? (decoderHeader = oggStreamHeader(bytes));
          decoder.postMessage({ command: "decode", pages: bytes }, [bytes.buffer]);
        } else if (type === "unmute.interrupted_by_vad" || isDuplexInterruptMessage(type)) {
          clearInterruptedAudio();
        } else if (type === "error") {
          const detail = asRecord(message["error"])?.["message"];
          if (typeof detail === "string" && /^Looking for the resources, expect some latency\.?$/i.test(detail.trim())) {
            report("resource-wait", "voice resources are loading", "warn");
            return;
          }
          fail("pod_error", typeof detail === "string" ? detail.slice(0, 200) : "voice session error");
        } else {
          captions.handle(message);
        }
      };
      socket.onclose = () => {
        if (!running || ws !== socket) return;
        if (!podLive && !sessionSent && attempts < 2) {
          timers.push(globalThis.setTimeout(() => {
            if (running) openSocket();
          }, 400));
          return;
        }
        if (!podLive) {
          fail("ws_failed", "voice socket closed before the session went live");
          return;
        }
        report("socket-closed", "voice socket closed", "warn");
        onTranscript?.("The call ended.");
        stop();
      };
    };
    openSocket();
    timers.push(globalThis.setTimeout(() => {
      if (running && !podLive) fail("pre_live_timeout", `no session.updated within ${duplexPreLiveMs + (ditto === void 0 ? 0 : duplexFaceReadyMs)}ms`);
    }, duplexPreLiveMs + (ditto === void 0 ? 0 : duplexFaceReadyMs)));
    if (typeof started.maxSeconds === "number" && started.maxSeconds > 0) {
      timers.push(globalThis.setTimeout(() => {
        if (!running) return;
        report("free-time", "granted seconds used up");
        stop();
      }, started.maxSeconds * 1e3 + 2e3));
    }
    const encoderWorker = new Worker(`${codecBase}encoderWorker.min.js`);
    encoder = encoderWorker;
    const onEncoderError = (kind, event) => {
      if (!running || encoder !== encoderWorker) return;
      event.preventDefault();
      const reason = duplexWorkerErrorReason("encoder", kind, firstAudioOutput, 0);
      report("encoder-error", reason, "error");
      fail("codec_failed", `encoder_worker_failed; ${reason}`);
    };
    encoderWorker.onerror = (event) => onEncoderError("error", event);
    encoderWorker.onmessageerror = (event) => onEncoderError("messageerror", event);
    const encoderReady = new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => reject(new Error("encoder did not start")), 1e4);
      timers.push(timeout);
      encoderWorker.onmessage = (event) => {
        const data = event.data;
        if (data.message === "ready") {
          globalThis.clearTimeout(timeout);
          resolve();
          return;
        }
        if (data.page instanceof Uint8Array && running) pump.page(bytesToBase64(data.page), isOggBeginningOfStream(data.page) || data.samplePosition === 0);
      };
    });
    encoderWorker.postMessage({
      command: "init",
      originalSampleRate: ctx.sampleRate,
      encoderSampleRate: 24e3,
      encoderFrameSize: 20,
      maxFramesPerPage: 2,
      numberOfChannels: 1,
      resampleQuality: 3,
      encoderComplexity: 0,
      encoderApplication: 2049,
      streamPages: true
    });
    if (await untilEnded(encoderReady) === ENDED) return void 0;
    if (await untilEnded(faceReady) === ENDED) return void 0;
    if (!running) return void 0;
    encoderWorker.postMessage({ command: "getHeaderPages" });
    micSource = ctx.createMediaStreamSource(stream);
    micProcessor = ctx.createScriptProcessor(2048, 1, 1);
    micSink = ctx.createGain();
    micSink.gain.value = 0;
    micProcessor.onaudioprocess = (event) => {
      if (!running) return;
      encoderWorker.postMessage({ command: "encode", buffers: [new Float32Array(event.inputBuffer.getChannelData(0))] });
    };
    micSource.connect(micProcessor);
    micProcessor.connect(micSink);
    micSink.connect(ctx.destination);
    microphoneReady = true;
    checkLive();
    try {
      deps.onAttached?.(ditto === void 0 ? "voice" : "video");
    } catch {
    }
  } catch (error) {
    fail("codec_failed", error instanceof Error ? error.message : String(error));
    return void 0;
  }
  return {
    sessionId,
    callKind: ditto === void 0 ? "voice" : "video",
    stack: "ditto-duplex",
    ...started.fallbackReason === void 0 ? {} : { fallbackReason: started.fallbackReason },
    ...started.contentPolicy === void 0 ? {} : { contentPolicy: started.contentPolicy },
    // The free clock starts at the first reply audio, after the face has shown or bowed out.
    isReady: () => running && podLive && microphoneReady && firstAudioOutput && faceSettled && !relayPending(),
    failed: () => hardFailure,
    degradedToVoice: () => faceEvicted,
    turnState: () => turnPhase,
    setMuted: (next) => {
      muted = next;
      pump.setMuted(muted || paused);
      emit.mute(next);
    },
    setPaused: (next) => {
      if (!running || next === paused) return;
      paused = next;
      pump.setMuted(muted || paused);
      if (gain !== void 0) gain.gain.value = paused ? 0 : 1;
      if (paused) {
        replyMetrics.invalidate();
        captions.flush();
        turnPhase = "listening";
      } else {
        dropReply = replyOpen;
      }
      dropHeldAudio();
      report("pause", paused ? "caller paused the call; microphone and reply audio held" : "caller resumed the call");
    },
    stop
  };
}
export {
  PM_AI_DUPLEX_CLIENT_VERSION,
  clampFaceAudioOffsetMs,
  clampLipSyncMs,
  createDuplexCaptions,
  createDuplexReplyTimingMetrics,
  createFaceAudioVoice,
  createLipSyncVoiceDelay,
  createPagePump,
  duplexCodecBase,
  duplexDecoderRestartLimit,
  duplexDegradeCopy,
  duplexFaceReadyMs,
  duplexFaceRelayReadyMs,
  duplexFirstAudioMs,
  duplexPreLiveMs,
  duplexSessionUpdate,
  duplexWorkerErrorReason,
  extractAiCallTranscript,
  faceAudioDefaultOffsetMs,
  faceAudioDuckDownMs,
  faceAudioDuckHoldMs,
  faceAudioDuckUpMs,
  faceAudioMaxOffsetMs,
  isDuplexInterruptMessage,
  isOggBeginningOfStream,
  joinCaptionDelta,
  lipSyncCrossfadeMs,
  lipSyncDefaultMs,
  lipSyncFlushDrainMs,
  lipSyncFlushRecoverMs,
  lipSyncMaxMs,
  observeSelectedAudioOutput,
  parseDuplexMessage,
  parsePairedFaceTimeline,
  startDuplexCall,
  syncVoicePaths
};
