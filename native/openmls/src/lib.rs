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
use openmls_traits::{
    OpenMlsProvider,
    crypto::OpenMlsCrypto,
    random::OpenMlsRand,
    types::{HpkeCiphertext, SignatureScheme},
};
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
    entitled: Vec<String>,
    server_epoch: u64,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Pending {
    from_epoch: u64,
    roster: Vec<String>,
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
    known_keys: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    GenerateKeys,
    Sign {
        #[serde(rename = "privateKey")]
        private_key: String,
        message: String,
    },
    Verify {
        #[serde(rename = "publicKey")]
        public_key: String,
        message: String,
        signature: String,
    },
    GenerateHpkeKeys,
    SealHistory {
        #[serde(rename = "publicKey")]
        public_key: String,
        message: String,
        info: String,
        aad: String,
    },
    OpenHistory {
        #[serde(rename = "privateKey")]
        private_key: String,
        enc: String,
        ciphertext: String,
        info: String,
        aad: String,
    },
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
fn signing_secret(encoded: &str) -> Result<SigningKey> {
    let private = bytes(encoded)?;
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
    Ok(secret)
}
fn signer(identity: &Identity, provider: &OpenMlsRustCrypto) -> Result<SignatureKeyPair> {
    identity_name(identity)?;
    let secret = signing_secret(&identity.private_key)?;
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
) -> Result<(
    OpenMlsRustCrypto,
    Option<Pending>,
    BTreeMap<String, Vec<u8>>,
)> {
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
    let mut known = BTreeMap::new();
    for (identity, key) in snapshot.known_keys {
        let Some((user, device)) = identity.split_once(':') else {
            return Err("invalid_state");
        };
        let key = bytes(&key)?;
        if !uuid(user) || !uuid(device) || key.len() != 32 {
            return Err("invalid_state");
        }
        known.insert(identity, key);
    }
    Ok((provider, snapshot.pending, known))
}
fn snapshot(
    provider: &OpenMlsRustCrypto,
    kind: &str,
    identity: &Identity,
    group_id: Option<&str>,
    pending: Option<Pending>,
    known: &BTreeMap<String, Vec<u8>>,
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
        known_keys: known
            .iter()
            .map(|(identity, key)| (identity.clone(), B64.encode(key)))
            .collect(),
    })
    .map_err(|_| "invalid_state")?;
    if encoded.len() > MAX_BYTES {
        return Err("state_too_large");
    }
    Ok(B64.encode(encoded))
}
fn members(group: &MlsGroup, context: &Context) -> Result<Vec<String>> {
    members_with_known(group, context, &BTreeMap::new())
}
fn members_with_known(
    group: &MlsGroup,
    context: &Context,
    known: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<String>> {
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
        if trusted
            .get(identity)
            .or_else(|| known.get(identity))
            .map(Vec::as_slice)
            != Some(member.signature_key.as_slice())
            || !members.insert(identity.to_owned())
        {
            return Err("untrusted_member");
        }
    }
    Ok(members.into_iter().collect())
}
fn exact_roster(group: &MlsGroup, context: &Context) -> Result<()> {
    same_roster(members(group, context)?, &context.entitled)
}
fn same_roster(members: Vec<String>, expected: &[String]) -> Result<()> {
    let actual: BTreeSet<_> = members
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
    known: BTreeMap<String, Vec<u8>>,
}
impl Loaded {
    fn new(
        provider: OpenMlsRustCrypto,
        group: MlsGroup,
        signer: SignatureKeyPair,
        pending: Option<Pending>,
        context: &Context,
    ) -> Result<Self> {
        let mut loaded = Self {
            provider,
            group,
            signer,
            pending,
            known: BTreeMap::new(),
        };
        loaded.learn_history(context)?;
        Ok(loaded)
    }
    // A valid incoming Welcome/commit can contain people erased since it was
    // written. These bindings remain ONLY on the recipient's device for old
    // reads and removal. They never authorize a new data-bearing ciphertext.
    fn learn_history(&mut self, context: &Context) -> Result<()> {
        let fresh = directory(context)?;
        for member in self.group.members() {
            if member.credential.credential_type() != CredentialType::Basic {
                return Err("untrusted_member");
            }
            let identity = std::str::from_utf8(member.credential.serialized_content())
                .map_err(|_| "untrusted_member")?;
            let Some((user, device)) = identity.split_once(':') else {
                return Err("untrusted_member");
            };
            if !uuid(user) || !uuid(device) || member.signature_key.len() != 32 {
                return Err("untrusted_member");
            }
            if fresh
                .get(identity)
                .or_else(|| self.known.get(identity))
                .is_some_and(|key| key.as_slice() != member.signature_key.as_slice())
            {
                return Err("untrusted_member");
            }
            self.known.insert(identity.to_owned(), member.signature_key);
        }
        members_with_known(&self.group, context, &self.known)?;
        Ok(())
    }
    fn historical_roster(&self, context: &Context, expected: &[String]) -> Result<()> {
        same_roster(
            members_with_known(&self.group, context, &self.known)?,
            expected,
        )
    }
    fn current_epoch(&self, context: &Context) -> Result<()> {
        if self.group.epoch().as_u64() != context.server_epoch {
            return Err("stale_epoch");
        }
        Ok(())
    }
    fn current_access(&self, context: &Context) -> Result<()> {
        self.current_epoch(context)?;
        exact_roster(&self.group, context)
    }
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
        let (provider, pending, known) =
            provider(state, "group", &context.identity, Some(&context.group_id))?;
        let signer = signer(&context.identity, &provider)?;
        let group = MlsGroup::load(
            provider.storage(),
            &GroupId::from_slice(context.group_id.as_bytes()),
        )
        .map_err(|_| "invalid_state")?
        .ok_or("invalid_state")?;
        members_with_known(&group, context, &known)?;
        let loaded = Self {
            provider,
            group,
            signer,
            pending,
            known,
        };
        loaded.own_identity(context)?;
        Ok(loaded)
    }
    fn response(&self, context: &Context, extra: Value) -> Result<Value> {
        self.own_identity(context)?;
        let members = members_with_known(&self.group, context, &self.known)?;
        let devices: Vec<_> = self.group.members().map(|member| {
            let identity = std::str::from_utf8(member.credential.serialized_content())
                .map_err(|_| "untrusted_member")?;
            let (user_id, device_id) = identity.split_once(':').ok_or("untrusted_member")?;
            Ok(json!({"userId":user_id,"deviceId":device_id,"signatureKey":B64.encode(member.signature_key)}))
        }).collect::<Result<Vec<_>>>()?;
        let mut output = json!({"state":snapshot(&self.provider,"group",&context.identity,Some(&context.group_id),self.pending.clone(),&self.known)?,"epoch":self.group.epoch().as_u64(),"members":members,"devices":devices,"pending":self.pending,"active":self.group.is_active()});
        if let (Some(output), Some(extra)) = (output.as_object_mut(), extra.as_object()) {
            output.extend(extra.clone());
        }
        Ok(output)
    }
}

fn run(request: Request) -> Result<Value> {
    match request {
        Request::Sign {
            private_key,
            message,
        } => {
            let provider = OpenMlsRustCrypto::default();
            let secret = signing_secret(&private_key)?;
            let signature = provider
                .crypto()
                .sign(
                    SignatureScheme::ED25519,
                    &bytes(&message)?,
                    secret.as_bytes(),
                )
                .map_err(|_| "signing_failed")?;
            Ok(json!({"signature":B64.encode(signature)}))
        }
        Request::Verify {
            public_key,
            message,
            signature,
        } => {
            let provider = OpenMlsRustCrypto::default();
            let key = bytes(&public_key)?;
            let signature = bytes(&signature)?;
            let valid = key.len() == 32
                && signature.len() == 64
                && provider
                    .crypto()
                    .verify_signature(
                        SignatureScheme::ED25519,
                        &bytes(&message)?,
                        &key,
                        &signature,
                    )
                    .is_ok();
            Ok(json!({"valid":valid}))
        }
        Request::GenerateHpkeKeys => {
            let provider = OpenMlsRustCrypto::default();
            let seed = provider
                .rand()
                .random_vec(32)
                .map_err(|_| "randomness_unavailable")?;
            let key = provider
                .crypto()
                .derive_hpke_keypair(SUITE.hpke_config(), &seed)
                .map_err(|_| "key_generation_failed")?;
            Ok(json!({"privateKey":B64.encode(&*key.private),"publicKey":B64.encode(key.public)}))
        }
        Request::SealHistory {
            public_key,
            message,
            info,
            aad,
        } => {
            let provider = OpenMlsRustCrypto::default();
            let key = bytes(&public_key)?;
            if key.len() != 32 {
                return Err("invalid_history_key");
            }
            let sealed = provider
                .crypto()
                .hpke_seal(
                    SUITE.hpke_config(),
                    &key,
                    &bytes(&info)?,
                    &bytes(&aad)?,
                    &bytes(&message)?,
                )
                .map_err(|_| "history_encryption_failed")?;
            Ok(
                json!({"enc":B64.encode(sealed.kem_output.as_slice()),"ciphertext":B64.encode(sealed.ciphertext.as_slice())}),
            )
        }
        Request::OpenHistory {
            private_key,
            enc,
            ciphertext,
            info,
            aad,
        } => {
            let provider = OpenMlsRustCrypto::default();
            let key = bytes(&private_key)?;
            let enc = bytes(&enc)?;
            if key.len() != 32 || enc.len() != 32 {
                return Err("invalid_history_key");
            }
            let sealed = HpkeCiphertext {
                kem_output: enc.into(),
                ciphertext: bytes(&ciphertext)?.into(),
            };
            let message = provider
                .crypto()
                .hpke_open(
                    SUITE.hpke_config(),
                    &sealed,
                    &key,
                    &bytes(&info)?,
                    &bytes(&aad)?,
                )
                .map_err(|_| "invalid_history_ciphertext")?;
            Ok(json!({"message":B64.encode(message)}))
        }
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
            // LastResort is not a default extension: its support must also be
            // declared in the leaf capabilities, or a conforming reader rejects
            // the package that the upstream builder otherwise produces.
            let builder = KeyPackage::builder().leaf_node_capabilities(Capabilities::new(
                Some(&[ProtocolVersion::Mls10]),
                Some(&[SUITE]),
                Some(&[ExtensionType::LastResort]),
                None,
                Some(&[CredentialType::Basic]),
            ));
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
                json!({"publicPackage":B64.encode(message.tls_serialize_detached().map_err(|_|"invalid_message")?),"state":snapshot(&provider,"keyPackage",&identity,None,None,&BTreeMap::new())?}),
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
            Loaded::new(provider, group, signer, None, &context)?.response(&context, json!({}))
        }
        Request::Join {
            context,
            state,
            welcome,
        } => {
            let (provider, pending, _) = provider(&state, "keyPackage", &context.identity, None)?;
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
                &MlsGroupJoinConfig::builder()
                    .use_ratchet_tree_extension(true)
                    .build(),
                welcome,
                None,
            )
            .map_err(|_| "invalid_welcome")?
            .into_group(&provider)
            .map_err(|_| "invalid_welcome")?;
            // Reading a historical Welcome does not grant current sharing.
            Loaded::new(provider, group, signer, None, &context)?.response(&context, json!({}))
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
            if from_epoch != context.server_epoch {
                return Err("stale_epoch");
            }
            let (group, bundle) = MlsGroup::external_commit_builder()
                .with_config(
                    MlsGroupJoinConfig::builder()
                        .use_ratchet_tree_extension(true)
                        .build(),
                )
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
                roster: context
                    .expected_roster
                    .clone()
                    .ok_or("missing_roster_proof")?,
                commit: B64.encode(
                    commit
                        .tls_serialize_detached()
                        .map_err(|_| "invalid_message")?,
                ),
                welcome: None,
            };
            let loaded = Loaded::new(provider, group, signer, Some(pending), &context)?;
            // Preserve the canonical roster and this device's pinned key.
            if !members_with_known(&loaded.group, &context, &loaded.known)?
                .contains(&identity_name(&context.identity)?)
            {
                return Err("untrusted_identity");
            }
            loaded.historical_roster(
                &context,
                &loaded.pending.as_ref().ok_or("invalid_state")?.roster,
            )?;
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
            check.historical_roster(
                &context,
                &loaded.pending.as_ref().ok_or("invalid_state")?.roster,
            )?;
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
            loaded.current_access(&context)?;
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
                }
                ProcessedMessageContent::OwnPendingCommit => return Err("use_pending_receipt"),
                // This delivery contract carries complete commits, not a
                // separately authorized queue of proposals.
                _ => return Err("unsupported_message"),
            }
            loaded.learn_history(&context)?;
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
            loaded.current_epoch(&context)?;
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
                roster: context.entitled.clone(),
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
            check.learn_history(&context)?;
            loaded.known.extend(check.known);
            loaded.response(&context, json!({}))
        }
        Request::AcceptPending {
            context,
            state,
            commit,
        } => {
            let mut loaded = Loaded::load(&context, &state)?;
            let receipt = loaded.pending.clone().ok_or("wrong_pending_receipt")?;
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
            loaded.historical_roster(&context, &receipt.roster)?;
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
            loaded.current_access(&context)?;
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
        json!({"groupId":"00000000-0000-4000-8000-000000000033","identity":who,"directory":people.iter().map(|p|json!({"userId":p["userId"],"deviceId":p["deviceId"],"signatureKey":p["publicKey"]})).collect::<Vec<_>>(),"expectedRoster":roster.iter().map(|p|p["deviceId"].clone()).collect::<Vec<_>>(),"entitled":roster.iter().map(|p|p["deviceId"].clone()).collect::<Vec<_>>(),"serverEpoch":1})
    }
    fn key_package(who: &Value, last_resort: bool) -> Value {
        invoke(json!({"op":"makeKeyPackage","identity":who,"lastResort":last_resort})).unwrap()
    }
    fn accept(context: &Value, pending: &Value) -> Value {
        invoke(json!({"op":"acceptPending","context":context,"state":pending["state"],"commit":pending["pending"]["commit"]})).unwrap()
    }
    fn group(a: &Value, b: &Value) -> (Value, Value) {
        let mut ca = context(a, &[a, b], &[a, b]);
        ca["serverEpoch"] = json!(0);
        let cb = context(b, &[a, b], &[a, b]);
        let created = invoke(json!({"op":"create","context":ca})).unwrap();
        let kp = key_package(b, false);
        let pending=invoke(json!({"op":"commit","context":ca,"state":created["state"],"add":[kp["publicPackage"]],"remove":[]})).unwrap();
        let alice = accept(&ca, &pending);
        let bob=invoke(json!({"op":"join","context":cb,"state":kp["state"],"welcome":pending["pending"]["welcome"]})).unwrap();
        (alice, bob)
    }

    #[test]
    fn signatures_bind_the_message_and_accept_existing_pkcs8_device_keys() {
        use ed25519_dalek::pkcs8::EncodePrivateKey;
        let a = person(1);
        let b = person(2);
        let message = B64.encode(b"freeholder:payload:v1\noriginal body");
        let signed =
            invoke(json!({"op":"sign","privateKey":a["privateKey"],"message":message})).unwrap();
        let secret = signing_secret(a["privateKey"].as_str().unwrap()).unwrap();
        let der = B64.encode(secret.to_pkcs8_der().unwrap().as_bytes());
        let existing = invoke(json!({"op":"sign","privateKey":der,"message":message})).unwrap();
        assert_eq!(existing, signed);
        assert_eq!(invoke(json!({"op":"verify","publicKey":a["publicKey"],"message":message,"signature":signed["signature"]})).unwrap()["valid"],true);
        assert_eq!(invoke(json!({"op":"verify","publicKey":b["publicKey"],"message":message,"signature":signed["signature"]})).unwrap()["valid"],false);
        assert_eq!(invoke(json!({"op":"verify","publicKey":a["publicKey"],"message":B64.encode(b"changed body"),"signature":signed["signature"]})).unwrap()["valid"],false);
    }

    #[test]
    fn sealed_history_binds_its_recipient_request_and_conversation() {
        let key = invoke(json!({"op":"generateHpkeKeys"})).unwrap();
        let other = invoke(json!({"op":"generateHpkeKeys"})).unwrap();
        let info = B64.encode(b"freeholder:history:v1");
        let aad = B64.encode(b"request-1\nconversation-1");
        let sealed=invoke(json!({"op":"sealHistory","publicKey":key["publicKey"],"message":B64.encode(b"readable historical messages"),"info":info,"aad":aad})).unwrap();
        let request = json!({"op":"openHistory","privateKey":key["privateKey"],"enc":sealed["enc"],"ciphertext":sealed["ciphertext"],"info":info,"aad":aad});
        assert_eq!(
            invoke(request.clone()).unwrap()["message"],
            B64.encode(b"readable historical messages")
        );
        let mut wrong = request.clone();
        wrong["privateKey"] = other["privateKey"].clone();
        assert_eq!(invoke(wrong), Err("invalid_history_ciphertext"));
        let mut wrong = request;
        wrong["aad"] = json!(B64.encode(b"request-1\nconversation-2"));
        assert_eq!(invoke(wrong), Err("invalid_history_ciphertext"));
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
    fn last_resort_packages_validate_and_join_two_distinct_conversations() {
        let a = person(1);
        let b = person(2);
        let kp = key_package(&b, true);
        assert_eq!(
            invoke(json!({"op":"readKeyPackage","encoded":kp["publicPackage"]})).unwrap()["signatureKey"],
            b["publicKey"]
        );
        for n in [33, 34] {
            let group_id = format!("00000000-0000-4000-8000-{n:012x}");
            let mut ca = context(&a, &[&a, &b], &[&a, &b]);
            ca["serverEpoch"] = json!(0);
            ca["groupId"] = json!(group_id);
            let mut cb = context(&b, &[&a, &b], &[&a, &b]);
            cb["groupId"] = json!(group_id);
            let initial = invoke(json!({"op":"create","context":ca})).unwrap();
            let pending = invoke(json!({"op":"commit","context":ca,"state":initial["state"],"add":[kp["publicPackage"]],"remove":[]})).unwrap();
            let accepted = accept(&ca, &pending);
            ca["serverEpoch"] = json!(1);
            let joined = invoke(json!({"op":"join","context":cb,"state":kp["state"],"welcome":pending["pending"]["welcome"]})).unwrap();
            let sent = invoke(json!({"op":"encrypt","context":ca,"state":accepted["state"],"message":B64.encode(group_id.as_bytes())})).unwrap();
            assert_eq!(invoke(json!({"op":"process","context":cb,"state":joined["state"],"message":sent["message"]})).unwrap()["payload"], B64.encode(group_id.as_bytes()));
        }
    }

    #[test]
    fn a_joined_member_can_add_another_device_with_a_self_contained_welcome() {
        let a = person(1);
        let b = person(2);
        let c = person(3);
        let (alice, bob) = group(&a, &b);
        let ca = context(&a, &[&a, &b, &c], &[&a, &b, &c]);
        let cb = context(&b, &[&a, &b, &c], &[&a, &b, &c]);
        let kp = key_package(&c, false);
        let pending = invoke(json!({"op":"commit","context":cb,"state":bob["state"],"add":[kp["publicPackage"]],"remove":[]})).unwrap();
        let mut cc = context(&c, &[&a, &b, &c], &[&a, &b, &c]);
        cc["serverEpoch"] = json!(2);
        let joined = invoke(json!({"op":"join","context":cc,"state":kp["state"],"welcome":pending["pending"]["welcome"]})).unwrap();
        let applied = invoke(json!({"op":"process","context":ca,"state":alice["state"],"message":pending["pending"]["commit"]})).unwrap();
        let sent = invoke(json!({"op":"encrypt","context":cc,"state":joined["state"],"message":B64.encode(b"third device joined")})).unwrap();
        assert_eq!(invoke(json!({"op":"process","context":ca,"state":applied["state"],"message":sent["message"]})).unwrap()["payload"], B64.encode(b"third device joined"));
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
        let mut ca = context(&a, &[&a, &b], &[&a]);
        let cb = context(&b, &[&a, &b], &[&a]);
        let pending=invoke(json!({"op":"commit","context":ca,"state":alice["state"],"add":[],"remove":[b["deviceId"]]})).unwrap();
        let next = accept(&ca, &pending);
        ca["serverEpoch"] = json!(2);
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
        let mut ca = context(&a, &[&a, &b], &[&a, &b]);
        ca["serverEpoch"] = json!(0);
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
    fn erased_public_keys_remain_local_history_pins_and_cannot_authorize_new_sharing() {
        let a = person(1);
        let b = person(2);
        let c = person(3);
        let (alice, bob) = group(&a, &b);
        let ca = context(&a, &[&a, &b, &c], &[&a, &b, &c]);
        let cb = context(&b, &[&a, &b, &c], &[&a, &b, &c]);
        let kp = key_package(&c, false);
        let added=invoke(json!({"op":"commit","context":ca,"state":alice["state"],"add":[kp["publicPackage"]],"remove":[]})).unwrap();
        let alice = accept(&ca, &added);
        let bob=invoke(json!({"op":"process","context":cb,"state":bob["state"],"message":added["pending"]["commit"]})).unwrap();
        // The server has erased C's key and seat; this device's already
        // authenticated old group still contains C until a removal commit.
        let mut ca = context(&a, &[&a, &b], &[&a, &b]);
        ca["serverEpoch"] = json!(2);
        let mut cb = context(&b, &[&a, &b], &[&a, &b]);
        cb["serverEpoch"] = json!(2);
        assert_eq!(
            invoke(
                json!({"op":"encrypt","context":ca,"state":alice["state"],"message":B64.encode(b"do not share")})
            ),
            Err("untrusted_member")
        );
        assert_eq!(
            invoke(
                json!({"op":"export","context":ca,"state":alice["state"],"label":"freeholder-call","info":"","length":32})
            ),
            Err("untrusted_member")
        );
        let removed=invoke(json!({"op":"commit","context":ca,"state":alice["state"],"add":[],"remove":[c["deviceId"]]})).unwrap();
        let alice = accept(&ca, &removed);
        let bob=invoke(json!({"op":"process","context":cb,"state":bob["state"],"message":removed["pending"]["commit"]})).unwrap();
        ca["serverEpoch"] = json!(3);
        cb["serverEpoch"] = json!(3);
        let message=invoke(json!({"op":"encrypt","context":ca,"state":alice["state"],"message":B64.encode(b"only current members")})).unwrap();
        let opened = invoke(
            json!({"op":"process","context":cb,"state":bob["state"],"message":message["message"]}),
        )
        .unwrap();
        assert_eq!(opened["payload"], B64.encode(b"only current members"));
    }

    #[test]
    fn an_old_welcome_can_be_read_after_erasure_but_must_be_reconciled_before_sending() {
        let a = person(1);
        let b = person(2);
        let c = person(3);
        let mut ca = context(&a, &[&a, &b, &c], &[&a, &b, &c]);
        ca["serverEpoch"] = json!(0);
        let created = invoke(json!({"op":"create","context":ca})).unwrap();
        let kb = key_package(&b, false);
        let kc = key_package(&c, false);
        let pending=invoke(json!({"op":"commit","context":ca,"state":created["state"],"add":[kb["publicPackage"],kc["publicPackage"]],"remove":[]})).unwrap();
        // B opens its original encrypted Welcome after C was erased. No
        // deleted public key is restored to the server's directory.
        let cb = context(&b, &[&a, &b], &[&a, &b]);
        let joined=invoke(json!({"op":"join","context":cb,"state":kb["state"],"welcome":pending["pending"]["welcome"]})).unwrap();
        assert_eq!(joined["members"].as_array().unwrap().len(), 3);
        assert_eq!(
            invoke(
                json!({"op":"encrypt","context":cb,"state":joined["state"],"message":B64.encode(b"too soon")})
            ),
            Err("untrusted_member")
        );
        let cleanup=invoke(json!({"op":"commit","context":cb,"state":joined["state"],"add":[],"remove":[c["deviceId"]]})).unwrap();
        let current = accept(&cb, &cleanup);
        assert_eq!(current["members"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn knowingly_stale_epochs_cannot_encrypt_or_export_new_secrets() {
        let a = person(1);
        let b = person(2);
        let (alice, _) = group(&a, &b);
        let mut ca = context(&a, &[&a, &b], &[&a, &b]);
        ca["serverEpoch"] = json!(2);
        assert_eq!(
            invoke(
                json!({"op":"encrypt","context":ca,"state":alice["state"],"message":B64.encode(b"stale")})
            ),
            Err("stale_epoch")
        );
        assert_eq!(
            invoke(
                json!({"op":"export","context":ca,"state":alice["state"],"label":"freeholder-call","info":"","length":32})
            ),
            Err("stale_epoch")
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
