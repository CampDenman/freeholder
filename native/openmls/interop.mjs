// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.39: only freshly generated synthetic keys, never an existing device store.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import initialize, { operate } from "../../public/_freeholder/openmls/0.1.0/freeholder_openmls.js";

const require = createRequire(new URL("../../package.json", import.meta.url));
const entry = pathToFileURL(require.resolve("ts-mls"));
const legacy = await import(entry.href);
const { createGroupInfo } = await import(new URL("./createCommit.js", entry));
const { encodeGroupInfo } = await import(new URL("./groupInfo.js", entry));
const { encode } = await import(new URL("./codec/tlsEncoder.js", entry));
const { varLenDataEncoder } = await import(new URL("./codec/variableLength.js", entry));
await initialize({ module_or_path: readFileSync(new URL("../../public/_freeholder/openmls/0.1.0/freeholder_openmls_bg.wasm", import.meta.url)) });
const call = input => JSON.parse(operate(JSON.stringify(input)));
const suite = await legacy.getCiphersuiteImpl(legacy.getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"));
const b64 = bytes => Buffer.from(bytes).toString("base64");
const raw = value => Buffer.from(value, "base64");
const text = value => new TextEncoder().encode(value);
const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const identities = [1, 2].map(n => `${uuid(n)}:${uuid(n + 100)}`);
const [alice, bob] = await Promise.all(identities.map(async identity => {
  const keys = await suite.signature.keygen();
  const kp = await legacy.generateKeyPackageWithKey({ credentialType: "basic", identity: text(identity) }, legacy.defaultCapabilities(), legacy.defaultLifetime, [], keys, suite);
  return { keys, ...kp };
}));
const groupId = uuid(33);
const group = await legacy.createGroup(text(groupId), alice.publicPackage, alice.privatePackage, [], suite);
const enrolled = await legacy.createCommit({ state: group, cipherSuite: suite }, { extraProposals: [{ proposalType: "add", add: { keyPackage: bob.publicPackage } }], ratchetTreeExtension: true });
let bobState = await legacy.joinGroup(enrolled.welcome, bob.publicPackage, bob.privatePackage, legacy.emptyPskIndex, suite);
const oldInfo = await legacy.createGroupInfoWithExternalPubAndRatchetTree(enrolled.newState, [], suite);
const info = await createGroupInfo(enrolled.newState.groupContext, enrolled.newState.confirmationTag, enrolled.newState, oldInfo.extensions.map(extension => extension.extensionType === "external_pub" ? { ...extension, extensionData: encode(varLenDataEncoder)(extension.extensionData) } : extension), suite);
const context = {
  groupId, identity: { userId: uuid(1), deviceId: uuid(101), privateKey: b64(alice.keys.signKey), publicKey: b64(alice.keys.publicKey) },
  directory: [alice, bob].map((person, n) => ({ userId: uuid(n + 1), deviceId: uuid(n + 101), signatureKey: b64(person.keys.publicKey) })),
  expectedRoster: [uuid(101), uuid(102)], entitled: [uuid(101), uuid(102)], serverEpoch: 1,
};
const kp = legacy.encodeMlsMessage({ version: "mls10", wireformat: "mls_key_package", keyPackage: bob.publicPackage });
assert.equal(call({ op: "readKeyPackage", encoded: b64(kp) }).identity, identities[1]);
const pending = call({ op: "migrate", context, groupInfo: b64(encodeGroupInfo(info)) });
assert.equal(pending.pending.fromEpoch, 1);
assert.equal(pending.epoch, 2);
let current = call({ op: "acceptPending", context, state: pending.state, commit: pending.pending.commit });
context.serverEpoch = 2;
assert.deepEqual(current.devices.map(device => device.signatureKey).sort(), [b64(alice.keys.publicKey), b64(bob.keys.publicKey)].sort());
const commit = legacy.decodeMlsMessage(raw(pending.pending.commit), 0)[0];
assert.equal(commit.wireformat, "mls_public_message");
bobState = (await legacy.processPublicMessage(bobState, commit.publicMessage, legacy.emptyPskIndex, suite)).newState;
const encrypted = call({ op: "encrypt", context, state: current.state, message: b64(text("Existing conversation, same identity")) });
current = encrypted;
const message = legacy.decodeMlsMessage(raw(encrypted.message), 0)[0];
const opened = await legacy.processPrivateMessage(bobState, message.privateMessage, legacy.emptyPskIndex, suite);
assert.equal(opened.kind, "applicationMessage");
assert.equal(new TextDecoder().decode(opened.message), "Existing conversation, same identity");

const body = text("freeholder:payload:v1\nunchanged original signature framing");
const signed = call({ op: "sign", privateKey: b64(alice.keys.signKey), message: b64(body) });
assert.ok(await suite.signature.verify(alice.keys.publicKey, body, raw(signed.signature)));
const oldSignature = await suite.signature.sign(bob.keys.signKey, body);
assert.equal(call({ op: "verify", publicKey: b64(bob.keys.publicKey), message: b64(body), signature: b64(oldSignature) }).valid, true);
assert.equal(call({ op: "verify", publicKey: b64(bob.keys.publicKey), message: b64(text("changed")), signature: b64(oldSignature) }).valid, false);

const historyInfo = text("freeholder:history:v1");
const aad = text(`${uuid(99)}\n${groupId}`);
const history = text("Original local history transfer");
const oldKey = await suite.hpke.generateKeyPair();
const oldPrivate = await suite.hpke.exportPrivateKey(oldKey.privateKey);
const oldPublic = await suite.hpke.exportPublicKey(oldKey.publicKey);
const newSealed = call({ op: "sealHistory", publicKey: b64(oldPublic), message: b64(history), info: b64(historyInfo), aad: b64(aad) });
assert.deepEqual(await suite.hpke.open(oldKey.privateKey, raw(newSealed.enc), raw(newSealed.ciphertext), historyInfo, aad), history);
const oldSealed = await suite.hpke.seal(oldKey.publicKey, history, historyInfo, aad);
assert.equal(call({ op: "openHistory", privateKey: b64(oldPrivate), enc: b64(oldSealed.enc), ciphertext: b64(oldSealed.ct), info: b64(historyInfo), aad: b64(aad) }).message, b64(history));
const newKey = call({ op: "generateHpkeKeys" });
const imported = await suite.hpke.importPublicKey(raw(newKey.publicKey));
const oldToNew = await suite.hpke.seal(imported, history, historyInfo, aad);
assert.equal(call({ op: "openHistory", privateKey: newKey.privateKey, enc: b64(oldToNew.enc), ciphertext: b64(oldToNew.ct), info: b64(historyInfo), aad: b64(aad) }).message, b64(history));
console.log("OpenMLS interop: legacy migration 1→2, unchanged device keys, both signature directions, existing/new HPKE history keys.");
