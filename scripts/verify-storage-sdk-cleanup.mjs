// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.08: installed SDK rehearsal; all upload/delete transports are in memory.
// Read-only review fixture: real pinned SDK, in-memory upload/delete transport.
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { Storage } from '@google-cloud/storage';
import { copyManifestObjects } from './media-transfer.mjs';
const original = Buffer.from('synthetic original source bytes');
const concurrent = Buffer.from('synthetic concurrent target owner bytes');
async function probe({ name, validation, concurrentWriter, uploadError = false }) {
  const storage = new Storage({ projectId: 'synthetic-review-only', retryOptions: { autoRetry: false } });
  const file = storage.bucket('synthetic-review-bucket').file('original-target');
  let actual, createCondition, cleanupCalls = 0, cleanupHadOptions = false;
  if (uploadError) {
    storage.authClient.request = async options => {
      createCondition = options.params?.ifGenerationMatch;
      actual = concurrent;
      throw Object.assign(new Error('synthetic original upload reply lost'), { code: 503 });
    };
  } else file.startResumableUpload_ = (duplex, options) => {
    createCondition = options.preconditionOpts?.ifGenerationMatch;
    duplex.on('error', () => {});
    duplex.setWritable(new Writable({
      write(_chunk, _encoding, callback) { callback(); },
      final(callback) {
        actual = concurrentWriter ? concurrent : original;
        if (uploadError) { callback(Object.assign(new Error('synthetic original upload reply lost'), { code: 503 })); return; }
        file.metadata = { crc32c: 'AAAAAA==', generation: '111' };
        duplex.emit('metadata'); duplex.emit('complete'); callback();
      },
    }));
  };
  file.delete = async options => { cleanupCalls++; cleanupHadOptions = options !== undefined; actual = undefined; return [{}]; };
  const source = { async get() { return original; } };
  const target = {
    async get() { return actual; },
    async put(_key, bytes, contentType) { await file.save(Buffer.from(bytes), { preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType }, ...(validation === undefined ? {} : { validation }) }); },
  };
  let error, resolved = false, timer;
  try {
    await Promise.race([
      copyManifestObjects({ manifest: { format: 'freeholder-media-manifest/v1', objects: [{ key: 'original-target', bytes: original.length, contentType: 'application/octet-stream' }] }, source, target }),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('review fixture timed out')), 3000); }),
    ]);
    resolved = true;
  } catch (caught) { error = caught; } finally { clearTimeout(timer); }
  return { name, createCondition, cleanupCalls, cleanupHadOptions, resolved, errorCode: error?.code ?? null, verifierRejected: error?.message?.includes('Target byte verification failed') ?? false, concurrentTargetPreserved: concurrentWriter ? actual?.equals(concurrent) ?? false : null };
}
const results = [];
results.push(await probe({ name: 'default CRC cleanup deletes a concurrent replacement', concurrentWriter: true }));
results.push(await probe({ name: 'validation false preserves replacement and caller SHA rejects it', validation: false, concurrentWriter: true }));
results.push(await probe({ name: 'validation false still copies and fully byte verifies correct bytes', validation: false, concurrentWriter: false }));
results.push(await probe({ name: 'validation false upload-error path never deletes replacement', validation: false, concurrentWriter: true, uploadError: true }));
assert.equal(results[0].createCondition, 0); assert.equal(results[0].cleanupCalls, 1); assert.equal(results[0].cleanupHadOptions, false); assert.equal(results[0].concurrentTargetPreserved, false);
assert.equal(results[1].cleanupCalls, 0); assert.equal(results[1].concurrentTargetPreserved, true); assert.equal(results[1].verifierRejected, true);
assert.equal(results[2].cleanupCalls, 0); assert.equal(results[2].resolved, true);
assert.equal(results[3].cleanupCalls, 0); assert.equal(results[3].concurrentTargetPreserved, true); assert.equal(results[3].resolved, false); assert.equal(results[3].errorCode, 503);
process.stdout.write(JSON.stringify({ pinnedSdkVersion: '7.22.0', realProviderRequests: 0, results }, null, 2) + '\n');
