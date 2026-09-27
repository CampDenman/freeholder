#!/usr/bin/env python3
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
"""C10.06: verified host update executor for non-Docker hosting targets.

Docker self-host and Droplet use docker-updater.py. This sibling covers the
remaining recipes (source-pull containers, systemd hosts, platform deploy
hooks) with the same discipline: the operator declares an immutable, digest-
pinned artifact and the commands their target's tooling runs; the executor
downloads and hashes the artifact, refuses to continue unless the backup hook
produces a real recoverable file, applies, health-checks, and rolls back with
an independently re-run health check. A run that was interrupted refuses to
resume silently. No success is recorded without the health hook passing.
"""
import argparse
import contextlib
import datetime
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import socketserver
import subprocess
import threading
import time
import urllib.request
import uuid

TERMINAL = {"completed", "rolled_back", "failed", "unchanged"}
SHA256 = re.compile(r"^[a-f0-9]{64}$")
ARTIFACT_CAP = 512 * 1024 * 1024


class Refused(RuntimeError):
    pass


def validate_sha256(value):
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise Refused("An immutable sha256 artifact digest is required.")
    return value


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def command(args, *, data=None, output=None, timeout=300, cwd=None, env=None):
    result = subprocess.run(args, input=data, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, cwd=cwd, env=env)
    if result.returncode:
        # Do not expose hook scripts' environment values or provider secrets.
        raise Refused("Host operation failed: " + args[0])
    return result.stdout.decode() if output is None else ""


def http_get(url, cap=ARTIFACT_CAP):
    request = urllib.request.Request(url, headers={"User-Agent": "Freeholder-host-updater"})
    chunks, size = [], 0
    with urllib.request.urlopen(request, timeout=60) as response:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
            size += len(chunk)
            if size > cap:
                raise Refused("Artifact exceeds the size limit.")


def load_config(path):
    path = Path(path).resolve()
    if path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
        raise Refused("Updater configuration must be root-owned and not writable by other users.")
    config = json.loads(path.read_text())
    for field in ("state_directory", "socket", "backup_produces"):
        if not Path(config[field]).is_absolute():
            raise Refused("Updater paths must be absolute.")
    artifact = config.get("artifact") or {}
    url = artifact.get("url", "")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise Refused("The artifact URL must be https.")
    validate_sha256(artifact.get("sha256", ""))
    if artifact.get("cosign_identity") is not None:
        if not str(artifact.get("cosign_identity", "")).startswith("https://"):
            raise Refused("The cosign identity must be an https URL.")
        if not str(artifact.get("signature_url", "")).startswith("https://"):
            raise Refused("cosign verification requires an https signature_url.")
    hooks = config.get("hooks") or {}
    for name in ("backup", "apply", "health", "rollback"):
        if not isinstance(hooks.get(name), str) or not hooks[name].strip():
            raise Refused(f"The {name} hook must be a non-empty command.")
    for name in ("maintenance_on", "maintenance_off"):
        if hooks.get(name) is not None and not isinstance(hooks.get(name), str):
            raise Refused(f"The {name} hook must be a command string.")
    timeout = config.get("health_timeout_seconds", 180)
    if type(timeout) is not int or not 1 <= timeout <= 900:
        raise Refused("health_timeout_seconds must be an integer from 1 to 900.")
    if type(config.get("automatic", False)) is not bool or type(config.get("utc_hour", 10)) is not int or not 0 <= config.get("utc_hour", 10) <= 23:
        raise Refused("Automatic scheduling requires a boolean and a UTC hour from 0 to 23.")
    return config


class Executor:
    """The verification state machine. Hooks are the operator's target tooling;
    the executor never records success unless backup and health both proved."""

    def __init__(self, config, run=command):
        self.config = config
        self.run = run
        self.state = Path(config["state_directory"]).resolve()
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state.chmod(0o700)
        self.record = None

    @contextlib.contextmanager
    def lock(self):
        import fcntl
        with (self.state / "executor.lock").open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise Refused("An update is already running.") from error
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def status(self):
        path = self.state / "status.json"
        return json.loads(path.read_text()) if path.exists() else {"status": "idle"}

    def stage(self, phase, **values):
        self.record.update(status=phase, **values)
        atomic_json(self.state / "status.json", self.record)
        atomic_json(self.release / "status.json", self.record)

    def hook(self, name, timeout=600):
        script = (self.config.get("hooks") or {}).get(name)
        if not script:
            raise Refused(f"The {name} hook is not configured.")
        env = dict(os.environ, FH_ARTIFACT=str(self.release / "artifact"))
        return self.run(["sh", "-c", script], timeout=timeout, env=env)

    def fetch(self, url):
        return http_get(url)

    def fetch_artifact(self):
        artifact = self.config["artifact"]
        data = self.fetch(artifact["url"])
        digest = hashlib.sha256(data).hexdigest()
        if digest != validate_sha256(artifact["sha256"]):
            raise Refused("Artifact digest mismatch. The pinned immutable artifact changed or the download is corrupt.")
        target = self.release / "artifact"
        target.write_bytes(data)
        target.chmod(0o600)
        if artifact.get("cosign_identity"):
            signature_url = artifact.get("signature_url")
            if not isinstance(signature_url, str) or not signature_url.startswith("https://"):
                raise Refused("cosign verification requires an https signature_url.")
            signature = self.fetch(signature_url)
            sig_path = self.release / "artifact.sig"
            sig_path.write_bytes(signature)
            sig_path.chmod(0o600)
            self.run(["cosign", "verify-blob", "--signature", str(sig_path),
                      "--certificate-identity", artifact["cosign_identity"],
                      "--certificate-oidc-issuer", artifact.get("cosign_issuer", "https://token.actions.githubusercontent.com"),
                      str(target)], timeout=180)
        return digest

    def verified_backup(self):
        # The readiness audit recorded a fingerprint and called it a backup.
        # A backup counts only when the hook produced a non-empty file at the
        # declared path.
        target = Path(self.config["backup_produces"])
        if target.exists():
            target.unlink()
        self.hook("backup")
        if not target.exists() or target.stat().st_size == 0:
            raise Refused("The backup hook produced no recoverable backup at backup_produces.")
        return target

    def health(self, timeout=None):
        deadline = time.monotonic() + (timeout if timeout is not None else self.config.get("health_timeout_seconds", 180))
        while time.monotonic() < deadline:
            try:
                return self.hook("health", timeout=30)
            except (Refused, subprocess.TimeoutExpired):
                time.sleep(2)
        raise Refused("Candidate did not become healthy before the deadline.")

    def maintenance(self, enabled):
        script = (self.config.get("hooks") or {}).get("maintenance_on" if enabled else "maintenance_off")
        if script:
            self.hook("maintenance_on" if enabled else "maintenance_off")

    def apply(self, trigger="cli", request_id=None, locked=False):
        with contextlib.nullcontext() if locked else self.lock():
            old = self.status()
            if old.get("status") not in TERMINAL | {"idle", "queued"}:
                raise Refused("An interrupted run requires operator recovery before another update.")
            self.record = {"id": request_id or str(uuid.uuid4()), "status": "verifying", "trigger": trigger,
                           "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            self.release = self.state / self.record["id"]
            self.release.mkdir(mode=0o700)
            maintenance = False
            applied = False
            try:
                digest = self.fetch_artifact()
                self.stage("fetched", artifactSha256=digest)
                backup = self.verified_backup()
                self.stage("backed_up", backup=str(backup))
                self.maintenance(True)
                maintenance = True
                self.hook("apply", timeout=900)
                applied = True
                self.stage("deploying")
                self.health()
                self.maintenance(False)
                maintenance = False
                self.stage("completed", completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
                return self.record
            except Exception as error:
                if applied:
                    try:
                        self.hook("rollback", timeout=900)
                        self.stage("rolling_back")
                        self.health()
                        self.maintenance(False)
                        maintenance = False
                        self.stage("rolled_back", error="Candidate failed; rollback ran and the health hook verified the previous deployment.")
                    except Exception:
                        self.stage("recovery_required", error="Recovery did not verify. Maintenance remains enabled; inspect the retained backup and host logs.")
                else:
                    if maintenance:
                        try:
                            self.maintenance(False)
                        except Exception:
                            self.stage("recovery_required", error="Unable to leave maintenance.")
                            raise
                    message = str(error) if isinstance(error, Refused) else "Host operation failed; inspect the host locally."
                    self.stage("failed", error=message)
                raise


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def prepare_socket_path(config):
    socket_path = Path(config["socket"])
    socket_path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    if socket_path.exists():
        if not socket_path.is_socket():
            raise Refused("Refusing to replace a non-socket path.")
        socket_path.unlink()
    return socket_path


def make_handler(config):
    queue_lock = threading.Lock()

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/status":
                return self.reply(404, {"error": "Unknown operation"})
            self.reply(200, {**Executor(config).status(), "automatic": config.get("automatic", False),
                             "utcHour": config.get("utc_hour", 10)})

        def do_POST(self):
            if self.path != "/apply":
                return self.reply(404, {"error": "Unknown operation"})
            size = int(self.headers.get("Content-Length", "0") or 0)
            if not 0 < size <= 512:
                return self.reply(400, {"error": "Invalid request size"})
            try:
                body = json.loads(self.rfile.read(size))
            except ValueError:
                return self.reply(400, {"error": "Invalid request"})
            if body != {}:
                return self.reply(400, {"error": "Unsupported request"})
            if not queue_lock.acquire(blocking=False):
                return self.reply(409, {"error": "An update is already running"})
            executor = Executor(config)
            lease = executor.lock()
            acquired = False
            try:
                lease.__enter__()
                acquired = True
                if executor.status().get("status") not in TERMINAL | {"idle"}:
                    raise Refused("An interrupted run needs operator recovery.")
            except Refused as error:
                if acquired:
                    lease.__exit__(None, None, None)
                queue_lock.release()
                return self.reply(409, {"error": str(error)})
            request_id = str(uuid.uuid4())
            atomic_json(executor.state / "status.json", {"id": request_id, "status": "queued"})

            def work():
                try:
                    executor.apply("socket", request_id=request_id, locked=True)
                except Exception:
                    pass # The durable status records failure; no fake completion.
                finally:
                    lease.__exit__(None, None, None)
                    queue_lock.release()
            threading.Thread(target=work, daemon=False).start()
            self.reply(202, {"id": request_id, "status": "queued"})

    return Handler


def due_for_scheduled_run(config, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return bool(config.get("automatic", False)) and now.hour == config.get("utc_hour", 10)


def serve(config):
    socket_path = prepare_socket_path(config)
    with Server(str(socket_path), make_handler(config)) as server:
        os.chown(socket_path, 0, int(config.get("app_gid", 1001)))
        socket_path.chmod(0o660)
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("serve", "apply", "scheduled", "status"))
    parser.add_argument("--config", default="/etc/freeholder/host-updater.json")
    args = parser.parse_args()
    os.umask(0o077)
    config = load_config(args.config)
    if args.operation == "serve":
        serve(config)
    elif args.operation == "status":
        print(json.dumps(Executor(config).status()))
    else:
        if args.operation == "scheduled" and not due_for_scheduled_run(config):
            return
        print(json.dumps(Executor(config).apply(trigger="schedule" if args.operation == "scheduled" else "cli")))


if __name__ == "__main__":
    try:
        main()
    except (Refused, subprocess.TimeoutExpired) as error:
        print(str(error), file=__import__("sys").stderr)
        raise SystemExit(1)
