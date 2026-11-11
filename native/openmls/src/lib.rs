// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
//! C12.39: a thin, bounded binding to OpenMLS. Private snapshots are for the
//! originating device's local store; they are never a delivery-service input.

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use ed25519_dalek::{SigningKey, pkcs8::DecodePrivateKey};
use openmls::messages::group_info::VerifiableGroupInfo;
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::{OpenMlsProvider, random::OpenMlsRand, types::SignatureScheme};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use tls_codec::{Deserialize as _, Serialize as _};
use wasm_bindgen::prelude::*;

const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const MAX_BYTES: usize = 16 * 1024 * 1024;
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    user_id: String,
    device_id: String,
    private_key: String,
    public_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
    user_id: String,
    device_id: String,
    signature_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Context {
    group_id: String,
    identity: Identity,
    directory: Vec<DirectoryEntry>,
    expected_roster: Option<Vec<String>>,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Pending {
    from_epoch: u64,
    commit: String,
    welcome: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    version: u8,
    kind: String,
    group_id: Option<String>,
    public_key: String,
    values: Vec<(String, String)>,
    pending: Option<Pending>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    GenerateKeys,
    MakeKeyPackage {
        identity: Identity,
        #[serde(rename = "lastResort")]
        last_resort: bool,
    },
    ReadKeyPackage {
        encoded: String,
    },
    Create {
        context: Context,
    },
    Join {
        context: Context,
        state: String,
        welcome: String,
    },
    Migrate {
        context: Context,
        #[serde(rename = "groupInfo")]
        group_info: String,
    },
    Encrypt {
        context: Context,
        state: String,
        message: String,
    },
    Process {
        context: Context,
        state: String,
        message: String,
    },
    Commit {
        context: Context,
        state: String,
        add: Vec<String>,
        remove: Vec<String>,
    },
    AcceptPending {
        context: Context,
        state: String,
        commit: String,
    },
    AbandonPending {
        context: Context,
        state: String,
    },
    Export {
        context: Context,
        state: String,
        label: String,
        info: String,
        length: usize,
    },
}

fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit() && !c.is_ascii_uppercase()
            }
        })
}
fn bytes(value: &str) -> Result<Vec<u8>> {
    if value.len() > MAX_BYTES * 2 {
        return Err("input_too_large");
    }
    let decoded = B64.decode(value).map_err(|_| "invalid_encoding")?;
    if decoded.len() > MAX_BYTES {
        return Err("input_too_large");
    }
    Ok(decoded)
}
fn identity_name(identity: &Identity) -> Result<String> {
    if !uuid(&identity.user_id) || !uuid(&identity.device_id) {
        return Err("invalid_identity");
    }
    Ok(format!("{}:{}", identity.user_id, identity.device_id))
}
fn signer(identity: &Identity, provider: &OpenMlsRustCrypto) -> Result<SignatureKeyPair> {
    identity_name(identity)?;
    let private = bytes(&identity.private_key)?;
    let secret = if private.len() == 32 {
        SigningKey::from_bytes(
            private
                .as_slice()
                .try_into()
                .map_err(|_| "invalid_identity")?,
        )
    } else {
        if private.len() > 1024 {
            return Err("invalid_identity");
        }
        SigningKey::from_pkcs8_der(&private).map_err(|_| "invalid_identity")?
    };
    let public = bytes(&identity.public_key)?;
    if secret.verifying_key().to_bytes().as_slice() != public {
        return Err("identity_key_mismatch");
    }
    let signer =
        SignatureKeyPair::from_raw(SignatureScheme::ED25519, secret.to_bytes().to_vec(), public);
    signer
        .store(provider.storage())
        .map_err(|_| "invalid_state")?;
    Ok(signer)
}
fn credential(identity: &Identity, signer: &SignatureKeyPair) -> Result<CredentialWithKey> {
    Ok(CredentialWithKey {
        credential: BasicCredential::new(identity_name(identity)?.into_bytes()).into(),
        signature_key: signer.public().into(),
    })
}
fn directory(context: &Context) -> Result<BTreeMap<String, Vec<u8>>> {
    if !uuid(&context.group_id) {
        return Err("invalid_group");
    }
    let mut result = BTreeMap::new();
    let mut devices = BTreeSet::new();
    for entry in &context.directory {
        if !uuid(&entry.user_id)
            || !uuid(&entry.device_id)
            || !devices.insert(entry.device_id.clone())
        {
            return Err("invalid_directory");
        }
        let key = bytes(&entry.signature_key)?;
        if key.len() != 32 {
            return Err("invalid_directory");
        }
        result.insert(format!("{}:{}", entry.user_id, entry.device_id), key);
    }
    if result.get(&identity_name(&context.identity)?) != Some(&bytes(&context.identity.public_key)?)
    {
        return Err("untrusted_identity");
    }
    Ok(result)
}
fn provider(
    state: &str,
    kind: &str,
    identity: &Identity,
    group_id: Option<&str>,
) -> Result<(OpenMlsRustCrypto, Option<Pending>)> {
    let decoded = bytes(state)?;
    let snapshot: Snapshot = serde_json::from_slice(&decoded).map_err(|_| "invalid_state")?;
    if snapshot.version != 1
        || snapshot.kind != kind
        || snapshot.group_id.as_deref() != group_id
        || snapshot.public_key != identity.public_key
    {
        return Err("invalid_state");
    }
    let provider = OpenMlsRustCrypto::default();
    {
        let mut store = provider
            .storage()
            .values
            .write()
            .map_err(|_| "invalid_state")?;
        for (key, value) in snapshot.values {
            let key = bytes(&key)?;
            if key.is_empty() || store.insert(key, bytes(&value)?).is_some() {
                return Err("invalid_state");
            }
        }
    }
    Ok((provider, snapshot.pending))
}
fn snapshot(
    provider: &OpenMlsRustCrypto,
    kind: &str,
    identity: &Identity,
    group_id: Option<&str>,
    pending: Option<Pending>,
) -> Result<String> {
    let store = provider
        .storage()
        .values
        .read()
        .map_err(|_| "invalid_state")?;
    let mut values: Vec<_> = store
        .iter()
        .map(|(key, value)| (B64.encode(key), B64.encode(value)))
        .collect();
    values.sort_by(|a, b| a.0.cmp(&b.0));
    let encoded = serde_json::to_vec(&Snapshot {
        version: 1,
        kind: kind.into(),
        group_id: group_id.map(str::to_owned),
        public_key: identity.public_key.clone(),
        values,
        pending,
    })
    .map_err(|_| "invalid_state")?;
    if encoded.len() > MAX_BYTES {
        return Err("state_too_large");
    }
    Ok(B64.encode(encoded))
}
fn members(group: &MlsGroup, context: &Context) -> Result<Vec<String>> {
    if group.group_id().as_slice() != context.group_id.as_bytes() || group.ciphersuite() != SUITE {
        return Err("wrong_group");
    }
    let trusted = directory(context)?;
    let mut members = BTreeSet::new();
    for member in group.members() {
        if member.credential.credential_type() != CredentialType::Basic {
            return Err("untrusted_member");
        }
        let identity = std::str::from_utf8(member.credential.serialized_content())
            .map_err(|_| "untrusted_member")?;
        if trusted.get(identity).map(Vec::as_slice) != Some(member.signature_key.as_slice())
            || !members.insert(identity.to_owned())
        {
            return Err("untrusted_member");
        }
    }
    Ok(members.into_iter().collect())
}
fn exact_roster(group: &MlsGroup, context: &Context) -> Result<()> {
    let expected = context
        .expected_roster
        .as_ref()
        .ok_or("missing_roster_proof")?;
    let actual: BTreeSet<_> = members(group, context)?
        .into_iter()
        .map(|id| id.rsplit(':').next().unwrap_or("").to_owned())
        .collect();
    let expected: BTreeSet<_> = expected.iter().cloned().collect();
    if actual != expected {
        return Err("roster_mismatch");
    }
    Ok(())
}
fn package(encoded: &str, provider: &OpenMlsRustCrypto) -> Result<KeyPackage> {
    let message =
        MlsMessageIn::tls_deserialize_exact(bytes(encoded)?).map_err(|_| "invalid_key_package")?;
    let MlsMessageBodyIn::KeyPackage(package) = message.extract() else {
        return Err("invalid_key_package");
    };
    let package = package
        .validate(provider.crypto(), ProtocolVersion::Mls10)
        .map_err(|_| "invalid_key_package")?;
    if package.ciphersuite() != SUITE {
        return Err("unsupported_suite");
    }
    Ok(package)
}
fn package_identity(package: &KeyPackage) -> Result<String> {
    if package.leaf_node().credential().credential_type() != CredentialType::Basic {
        return Err("invalid_identity");
    }
    let identity = std::str::from_utf8(package.leaf_node().credential().serialized_content())
        .map_err(|_| "invalid_identity")?;
    let Some((user, device)) = identity.split_once(':') else {
        return Err("invalid_identity");
    };
    if !uuid(user) || !uuid(device) {
        return Err("invalid_identity");
    }
    Ok(identity.to_owned())
}

struct Loaded {
    provider: OpenMlsRustCrypto,
    group: MlsGroup,
    signer: SignatureKeyPair,
    pending: Option<Pending>,
}
impl Loaded {
    fn own_identity(&self, context: &Context) -> Result<()> {
        if self.group.is_active() && self.pending.is_none() {
            let own = self.group.own_leaf_node().ok_or("wrong_device_state")?;
            if own.credential().serialized_content() != identity_name(&context.identity)?.as_bytes()
                || own.signature_key().as_slice() != bytes(&context.identity.public_key)?
            {
                return Err("wrong_device_state");
            }
        }
        Ok(())
    }
    fn load(context: &Context, state: &str) -> Result<Self> {
        let (provider, pending) =
            provider(state, "group", &context.identity, Some(&context.group_id))?;
        let signer = signer(&context.identity, &provider)?;
        let group = MlsGroup::load(
            provider.storage(),
            &GroupId::from_slice(context.group_id.as_bytes()),
        )
        .map_err(|_| "invalid_state")?
        .ok_or("invalid_state")?;
        members(&group, context)?;
        let loaded = Self {
            provider,
            group,
            signer,
            pending,
        };
        loaded.own_identity(context)?;
        Ok(loaded)
    }
    fn response(&self, context: &Context, extra: Value) -> Result<Value> {
        self.own_identity(context)?;
        let mut output = json!({"state":snapshot(&self.provider,"group",&context.identity,Some(&context.group_id),self.pending.clone())?,"epoch":self.group.epoch().as_u64(),"members":members(&self.group,context)?,"pending":self.pending,"active":self.group.is_active()});
        if let (Some(output), Some(extra)) = (output.as_object_mut(), extra.as_object()) {
            output.extend(extra.clone());
        }
        Ok(output)
    }
}

fn run(request: Request) -> Result<Value> {
    match request {
        Request::GenerateKeys => {
            let provider = OpenMlsRustCrypto::default();
            let seed = provider
                .rand()
                .random_vec(32)
                .map_err(|_| "randomness_unavailable")?;
            let key =
                SigningKey::from_bytes(seed.as_slice().try_into().map_err(|_| "invalid_identity")?);
            Ok(
                json!({"privateKey":B64.encode(&seed),"publicKey":B64.encode(key.verifying_key().to_bytes())}),
            )
        }
        Request::MakeKeyPackage {
            identity,
            last_resort,
        } => {
            let provider = OpenMlsRustCrypto::default();
            let signer = signer(&identity, &provider)?;
            let builder = KeyPackage::builder();
            let builder = if last_resort {
                builder.mark_as_last_resort()
            } else {
                builder
            };
            let bundle = builder
                .build(SUITE, &provider, &signer, credential(&identity, &signer)?)
                .map_err(|_| "key_package_failed")?;
            let message: MlsMessageOut = bundle.key_package().clone().into();
            Ok(
                json!({"publicPackage":B64.encode(message.tls_serialize_detached().map_err(|_|"invalid_message")?),"state":snapshot(&provider,"keyPackage",&identity,None,None)?}),
            )
        }
        Request::ReadKeyPackage { encoded } => {
            let provider = OpenMlsRustCrypto::default();
            let package = package(&encoded, &provider)?;
            Ok(
                json!({"identity":package_identity(&package)?,"signatureKey":B64.encode(package.leaf_node().signature_key().as_slice())}),
            )
        }
        Request::Create { context } => {
            let provider = OpenMlsRustCrypto::default();
            let signer = signer(&context.identity, &provider)?;
            let group = MlsGroup::builder()
                .ciphersuite(SUITE)
                .use_ratchet_tree_extension(true)
                .with_group_id(GroupId::from_slice(context.group_id.as_bytes()))
                .build(&provider, &signer, credential(&context.identity, &signer)?)
                .map_err(|_| "group_failed")?;
            Loaded {
                provider,
                group,
                signer,
                pending: None,
            }
            .response(&context, json!({}))
        }
        Request::Join {
            context,
            state,
            welcome,
        } => {
            let (provider, pending) = provider(&state, "keyPackage", &context.identity, None)?;
            if pending.is_some() {
                return Err("invalid_state");
            }
            let signer = signer(&context.identity, &provider)?;
            let message = MlsMessageIn::tls_deserialize_exact(bytes(&welcome)?)
                .map_err(|_| "invalid_welcome")?;
            let MlsMessageBodyIn::Welcome(welcome) = message.extract() else {
                return Err("invalid_welcome");
            };
            let group = StagedWelcome::new_from_welcome(
                &provider,
                &MlsGroupJoinConfig::builder().build(),
                welcome,
                None,
            )
            .map_err(|_| "invalid_welcome")?
            .into_group(&provider)
            .map_err(|_| "invalid_welcome")?;
            exact_roster(&group, &context)?;
            Loaded {
                provider,
                group,
                signer,
                pending: None,
            }
            .response(&context, json!({}))
        }
        Request::Migrate {
            context,
            group_info,
        } => {
            let provider = OpenMlsRustCrypto::default();
            let signer = signer(&context.identity, &provider)?;
            let info = VerifiableGroupInfo::tls_deserialize_exact(bytes(&group_info)?)
                .map_err(|_| "invalid_group_info")?;
            if info.group_id().as_slice() != context.group_id.as_bytes()
                || info.ciphersuite() != SUITE
            {
                return Err("wrong_group");
            }
            let from_epoch = info.epoch().as_u64();
            let (group, bundle) = MlsGroup::external_commit_builder()
                .build_group(&provider, info, credential(&context.identity, &signer)?)
                .map_err(|_| "invalid_group_info")?
                .load_psks(provider.storage())
                .map_err(|_| "invalid_state")?
                .build(provider.rand(), provider.crypto(), &signer, |_| true)
                .map_err(|_| "migration_failed")?
                .finalize(&provider)
                .map_err(|_| "migration_failed")?;
            let (commit, _, _) = bundle.into_messages();
            let pending = Pending {
                from_epoch,
                commit: B64.encode(
                    commit
                        .tls_serialize_detached()
                        .map_err(|_| "invalid_message")?,
                ),
                welcome: None,
            };
            let loaded = Loaded {
                provider,
                group,
                signer,
                pending: Some(pending),
            };
            // Preserve the canonical roster and this device's pinned key.
            if !members(&loaded.group, &context)?.contains(&identity_name(&context.identity)?) {
                return Err("untrusted_identity");
            }
            exact_roster(&loaded.group, &context)?;
            let response = loaded.response(&context, json!({}))?;
            let encoded = response
                .get("state")
                .and_then(Value::as_str)
                .ok_or("invalid_state")?;
            let mut check = Loaded::load(&context, encoded)?;
            check
                .group
                .merge_pending_commit(&check.provider)
                .map_err(|_| "invalid_commit")?;
            check.pending = None;
            check.own_identity(&context)?;
            exact_roster(&check.group, &context)?;
            Ok(response)
        }
        Request::Encrypt {
            context,
            state,
            message,
        } => {
            let mut loaded = Loaded::load(&context, &state)?;
            if loaded.pending.is_some() {
                return Err("pending_commit");
            }
            exact_roster(&loaded.group, &context)?;
            let message = loaded
                .group
                .create_message(&loaded.provider, &loaded.signer, &bytes(&message)?)
                .map_err(|_| "encryption_failed")?;
            // The caller must commit this returned snapshot before transport.
            loaded.response(&context,json!({"message":B64.encode(message.tls_serialize_detached().map_err(|_|"invalid_message")?)}))
        }
        Request::Process {
            context,
            state,
            message,
        } => {
            let mut loaded = Loaded::load(&context, &state)?;
            let message = MlsMessageIn::tls_deserialize_exact(bytes(&message)?)
                .map_err(|_| "invalid_message")?;
            let protocol = message
                .try_into_protocol_message()
                .map_err(|_| "invalid_message")?;
            let processed = loaded
                .group
                .process_message(&loaded.provider, protocol)
                .map_err(|_| "invalid_message")?;
            let sender = std::str::from_utf8(processed.credential().serialized_content())
                .map_err(|_| "untrusted_member")?
                .to_owned();
            let message_epoch = processed.epoch().as_u64();
            let mut payload = None;
            match processed.into_content() {
                ProcessedMessageContent::ApplicationMessage(message) => {
                    payload = Some(B64.encode(message.into_bytes()));
                }
                ProcessedMessageContent::StagedCommitMessage(commit) => {
                    loaded
                        .group
                        .merge_staged_commit(&loaded.provider, *commit)
                        .map_err(|_| "invalid_commit")?;
                    loaded.pending = None;
                    exact_roster(&loaded.group, &context)?;
                }
                ProcessedMessageContent::OwnPendingCommit => return Err("use_pending_receipt"),
                // This delivery contract carries complete commits, not a
                // separately authorized queue of proposals.
                _ => return Err("unsupported_message"),
            }
            loaded.response(
                &context,
                json!({"payload":payload,"sender":sender,"messageEpoch":message_epoch}),
            )
        }
        Request::Commit {
            context,
            state,
            add,
            remove,
        } => {
            let mut loaded = Loaded::load(&context, &state)?;
            if loaded.pending.is_some() {
                return Err("pending_commit");
            }
            let trusted = directory(&context)?;
            let mut packages = Vec::new();
            for encoded in add {
                let package = package(&encoded, &loaded.provider)?;
                let who = package_identity(&package)?;
                if trusted.get(&who).map(Vec::as_slice)
                    != Some(package.leaf_node().signature_key().as_slice())
                {
                    return Err("untrusted_member");
                }
                packages.push(package);
            }
            let requested: BTreeSet<_> = remove.into_iter().collect();
            let removed: Vec<_> = loaded
                .group
                .members()
                .filter(|member| {
                    std::str::from_utf8(member.credential.serialized_content())
                        .ok()
                        .and_then(|id| id.rsplit(':').next())
                        .is_some_and(|id| requested.contains(id))
                })
                .map(|member| member.index)
                .collect();
            if removed.len() != requested.len() {
                return Err("invalid_removal");
            }
            let from_epoch = loaded.group.epoch().as_u64();
            let bundle = loaded
                .group
                .commit_builder()
                .propose_adds(packages)
                .propose_removals(removed)
                .load_psks(loaded.provider.storage())
                .map_err(|_| "invalid_state")?
                .build(
                    loaded.provider.rand(),
                    loaded.provider.crypto(),
                    &loaded.signer,
                    |_| true,
                )
                .map_err(|_| "commit_failed")?
                .stage_commit(&loaded.provider)
                .map_err(|_| "commit_failed")?;
            let (commit, welcome, _) = bundle.into_messages();
            loaded.pending = Some(Pending {
                from_epoch,
                commit: B64.encode(
                    commit
                        .tls_serialize_detached()
                        .map_err(|_| "invalid_message")?,
                ),
                welcome: welcome
                    .map(|message| {
                        message
                            .tls_serialize_detached()
                            .map(|bytes| B64.encode(bytes))
                    })
                    .transpose()
                    .map_err(|_| "invalid_message")?,
            });
            let response = loaded.response(&context, json!({}))?;
            // Validate the resulting roster on a local clone BEFORE returning
            // a commit or Welcome that could disclose future group secrets.
            let encoded = response
                .get("state")
                .and_then(Value::as_str)
                .ok_or("invalid_state")?;
            let mut check = Loaded::load(&context, encoded)?;
            check
                .group
                .merge_pending_commit(&check.provider)
                .map_err(|_| "invalid_commit")?;
            exact_roster(&check.group, &context)?;
            Ok(response)
        }
        Request::AcceptPending {
            context,
            state,
            commit,
        } => {
            let mut loaded = Loaded::load(&context, &state)?;
            if loaded
                .pending
                .as_ref()
                .map(|pending| pending.commit.as_str())
                != Some(commit.as_str())
            {
                return Err("wrong_pending_receipt");
            }
            loaded
                .group
                .merge_pending_commit(&loaded.provider)
                .map_err(|_| "invalid_commit")?;
            if loaded.group.epoch().as_u64()
                != loaded
                    .pending
                    .as_ref()
                    .ok_or("invalid_commit")?
                    .from_epoch
                    .checked_add(1)
                    .ok_or("invalid_commit")?
            {
                return Err("invalid_commit");
            }
            loaded.pending = None;
            exact_roster(&loaded.group, &context)?;
            loaded.response(&context, json!({}))
        }
        Request::AbandonPending { context, state } => {
            let mut loaded = Loaded::load(&context, &state)?;
            loaded
                .group
                .clear_pending_commit(loaded.provider.storage())
                .map_err(|_| "invalid_commit")?;
            loaded.pending = None;
            loaded.response(&context, json!({}))
        }
        Request::Export {
            context,
            state,
            label,
            info,
            length,
        } => {
            let loaded = Loaded::load(&context, &state)?;
            if loaded.pending.is_some() || length > 1024 || label.len() > 256 {
                return Err("invalid_export");
            }
            exact_roster(&loaded.group, &context)?;
            let secret = loaded
                .group
                .export_secret(loaded.provider.crypto(), &label, &bytes(&info)?, length)
                .map_err(|_| "invalid_export")?;
            loaded.response(&context, json!({"secret":B64.encode(secret)}))
        }
    }
}

/// Private inputs and snapshots stay in the caller's local crypto adapter.
/// Errors contain a fixed code, never a key, snapshot or provider error dump.
#[wasm_bindgen]
pub fn operate(input: &str) -> std::result::Result<String, JsError> {
    if input.len() > MAX_BYTES * 2 {
        return Err(JsError::new("input_too_large"));
    }
    let request = serde_json::from_str(input).map_err(|_| JsError::new("invalid_request"))?;
    let output = run(request).map_err(JsError::new)?;
    serde_json::to_string(&output).map_err(|_| JsError::new("invalid_response"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invoke(value: Value) -> Result<Value> {
        run(serde_json::from_value(value).map_err(|_| "invalid_request")?)
    }
    fn person(n: u32) -> Value {
        let keys = invoke(json!({"op":"generateKeys"})).unwrap();
        json!({"userId":format!("00000000-0000-4000-8000-{n:012x}"),"deviceId":format!("00000000-0000-4000-8000-{:012x}",n+100),"privateKey":keys["privateKey"],"publicKey":keys["publicKey"]})
    }
    fn context(who: &Value, people: &[&Value], roster: &[&Value]) -> Value {
        json!({"groupId":"00000000-0000-4000-8000-000000000033","identity":who,"directory":people.iter().map(|p|json!({"userId":p["userId"],"deviceId":p["deviceId"],"signatureKey":p["publicKey"]})).collect::<Vec<_>>(),"expectedRoster":roster.iter().map(|p|p["deviceId"].clone()).collect::<Vec<_>>()})
    }
    fn key_package(who: &Value, last_resort: bool) -> Value {
        invoke(json!({"op":"makeKeyPackage","identity":who,"lastResort":last_resort})).unwrap()
    }
    fn accept(context: &Value, pending: &Value) -> Value {
        invoke(json!({"op":"acceptPending","context":context,"state":pending["state"],"commit":pending["pending"]["commit"]})).unwrap()
    }
    fn group(a: &Value, b: &Value) -> (Value, Value) {
        let ca = context(a, &[a, b], &[a, b]);
        let cb = context(b, &[a, b], &[a, b]);
        let created = invoke(json!({"op":"create","context":ca})).unwrap();
        let kp = key_package(b, false);
        let pending=invoke(json!({"op":"commit","context":ca,"state":created["state"],"add":[kp["publicPackage"]],"remove":[]})).unwrap();
        let alice = accept(&ca, &pending);
        let bob=invoke(json!({"op":"join","context":cb,"state":kp["state"],"welcome":pending["pending"]["welcome"]})).unwrap();
        (alice, bob)
    }

    #[test]
    fn public_packages_are_verified_and_trailing_or_tampered_bytes_are_refused() {
        let a = person(1);
        let kp = key_package(&a, false);
        let proof = invoke(json!({"op":"readKeyPackage","encoded":kp["publicPackage"]})).unwrap();
        assert_eq!(proof["signatureKey"], a["publicKey"]);
        let mut encoded = bytes(kp["publicPackage"].as_str().unwrap()).unwrap();
        encoded.push(0);
        assert_eq!(
            invoke(json!({"op":"readKeyPackage","encoded":B64.encode(&encoded)})),
            Err("invalid_key_package")
        );
        encoded.pop();
        *encoded.last_mut().unwrap() ^= 1;
        assert_eq!(
            invoke(json!({"op":"readKeyPackage","encoded":B64.encode(&encoded)})),
            Err("invalid_key_package")
        );
    }

    #[test]
    fn snapshots_reload_and_sender_ratchets_advance_before_delivery() {
        let a = person(1);
        let b = person(2);
        let (alice, bob) = group(&a, &b);
        let ca = context(&a, &[&a, &b], &[&a, &b]);
        let cb = context(&b, &[&a, &b], &[&a, &b]);
        let first=invoke(json!({"op":"encrypt","context":ca,"state":alice["state"],"message":B64.encode(b"lost response")})).unwrap();
        let second=invoke(json!({"op":"encrypt","context":ca,"state":first["state"],"message":B64.encode(b"next generation")})).unwrap();
        assert_ne!(first["state"], second["state"]);
        assert_ne!(first["message"], second["message"]);
        let opened = invoke(
            json!({"op":"process","context":cb,"state":bob["state"],"message":second["message"]}),
        )
        .unwrap();
        assert_eq!(opened["payload"], B64.encode(b"next generation"));
        assert_eq!(opened["messageEpoch"], 1);
        assert_eq!(
            invoke(
                json!({"op":"process","context":cb,"state":opened["state"],"message":second["message"]})
            ),
            Err("invalid_message")
        );
        let earlier = invoke(
            json!({"op":"process","context":cb,"state":opened["state"],"message":first["message"]}),
        )
        .unwrap();
        assert_eq!(earlier["payload"], B64.encode(b"lost response"));
    }

    #[test]
    fn removal_rotates_secrets_and_the_removed_device_cannot_send_or_read_next_epoch() {
        let a = person(1);
        let b = person(2);
        let (alice, bob) = group(&a, &b);
        let ca = context(&a, &[&a, &b], &[&a]);
        let cb = context(&b, &[&a, &b], &[&a]);
        let pending=invoke(json!({"op":"commit","context":ca,"state":alice["state"],"add":[],"remove":[b["deviceId"]]})).unwrap();
        let next = accept(&ca, &pending);
        let removed=invoke(json!({"op":"process","context":cb,"state":bob["state"],"message":pending["pending"]["commit"]})).unwrap();
        assert_eq!(removed["active"], false);
        let message=invoke(json!({"op":"encrypt","context":ca,"state":next["state"],"message":B64.encode(b"after removal")})).unwrap();
        assert!(invoke(json!({"op":"process","context":cb,"state":removed["state"],"message":message["message"]})).is_err());
        assert!(invoke(json!({"op":"encrypt","context":cb,"state":removed["state"],"message":B64.encode(b"no longer entitled")})).is_err());
    }

    #[test]
    fn no_commit_or_welcome_is_returned_for_a_known_but_unauthorized_extra_device() {
        let a = person(1);
        let b = person(2);
        let m = person(3);
        let (alice, _) = group(&a, &b);
        let cm = context(&a, &[&a, &b, &m], &[&a, &b]);
        let kp = key_package(&m, false);
        assert_eq!(
            invoke(
                json!({"op":"commit","context":cm,"state":alice["state"],"add":[kp["publicPackage"]],"remove":[]})
            ),
            Err("roster_mismatch")
        );
    }

    #[test]
    fn pending_commits_need_the_exact_receipt_and_cannot_send_application_messages() {
        let a = person(1);
        let b = person(2);
        let ca = context(&a, &[&a, &b], &[&a, &b]);
        let created = invoke(json!({"op":"create","context":ca})).unwrap();
        let kp = key_package(&b, false);
        let pending=invoke(json!({"op":"commit","context":ca,"state":created["state"],"add":[kp["publicPackage"]],"remove":[]})).unwrap();
        assert_eq!(
            invoke(
                json!({"op":"acceptPending","context":ca,"state":pending["state"],"commit":"different receipt"})
            ),
            Err("wrong_pending_receipt")
        );
        assert_eq!(
            invoke(
                json!({"op":"encrypt","context":ca,"state":pending["state"],"message":B64.encode(b"too early")})
            ),
            Err("pending_commit")
        );
        let accepted = accept(&ca, &pending);
        assert_eq!(accepted["epoch"], 1);
        assert!(accepted["pending"].is_null());
    }

    #[test]
    fn group_and_device_snapshots_cannot_be_substituted() {
        let a = person(1);
        let b = person(2);
        let (alice, _) = group(&a, &b);
        let mut wrong = context(&a, &[&a, &b], &[&a, &b]);
        wrong["groupId"] = json!("00000000-0000-4000-8000-000000000044");
        assert_eq!(
            invoke(
                json!({"op":"encrypt","context":wrong,"state":alice["state"],"message":B64.encode(b"wrong group")})
            ),
            Err("invalid_state")
        );
        let cb = context(&b, &[&a, &b], &[&a, &b]);
        assert_eq!(
            invoke(
                json!({"op":"encrypt","context":cb,"state":alice["state"],"message":B64.encode(b"wrong device")})
            ),
            Err("invalid_state")
        );
    }

    #[test]
    fn mismatched_signing_keys_and_corrupt_state_versions_are_refused() {
        let a = person(1);
        let b = person(2);
        let mut wrong = a.clone();
        wrong["privateKey"] = b["privateKey"].clone();
        assert_eq!(
            invoke(json!({"op":"makeKeyPackage","identity":wrong,"lastResort":false})),
            Err("identity_key_mismatch")
        );
        let (alice, _) = group(&a, &b);
        let mut state: Value =
            serde_json::from_slice(&bytes(alice["state"].as_str().unwrap()).unwrap()).unwrap();
        state["version"] = json!(2);
        assert_eq!(
            invoke(
                json!({"op":"encrypt","context":context(&a,&[&a,&b],&[&a,&b]),"state":B64.encode(serde_json::to_vec(&state).unwrap()),"message":B64.encode(b"corrupt version")})
            ),
            Err("invalid_state")
        );
    }
}
